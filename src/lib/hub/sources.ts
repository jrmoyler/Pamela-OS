import dns from "node:dns/promises";
import net from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { getSecret } from "../settings";
import { putFile } from "../storage";

/**
 * Pulling files in from the places Pamela keeps them: any link, Google Drive and
 * Dropbox. Everything lands in the Library (the files table) with its source
 * recorded, so a file is never pulled twice by the folder sync.
 */

export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export type RemoteFile = { id: string; name: string; mime: string; size: number | null; modifiedAt: string | null; isFolder: boolean; link?: string };

/* ───────────── Safe fetching of outside URLs ───────────── */

function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Agents can hand us URLs, so refuse anything that resolves inside the server's own network. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That isn't a valid link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) links can be imported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new Error(`Couldn't reach ${url.hostname}.`);
  if (addrs.some(privateAddress)) throw new Error("Links to private network addresses can't be imported.");
  return url;
}

async function readCapped(res: Response, limit = MAX_IMPORT_BYTES): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > limit) throw new Error(`File is too large (over ${Math.round(limit / 1024 / 1024)} MB).`);
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`File is too large (over ${Math.round(limit / 1024 / 1024)} MB).`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Share links that open a preview page are rewritten to their direct-download form. */
export function directDownloadUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "drive.google.com") {
    const id = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? url.searchParams.get("id");
    if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  if (host === "docs.google.com") {
    const m = url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
    if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/export?format=${m[1] === "spreadsheets" ? "xlsx" : "pdf"}`;
  }
  if (host === "dropbox.com" || host.endsWith(".dropbox.com")) {
    url.searchParams.delete("dl");
    url.searchParams.set("dl", "1");
    return url.toString();
  }
  return raw;
}

function nameFrom(res: Response, url: URL): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1];
  const plain = cd.match(/filename="?([^";]+)"?/i)?.[1];
  const raw = star ? decodeURIComponent(star.replace(/"/g, "")) : plain;
  if (raw) return raw.trim();
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  return last && last.length < 120 ? last : url.hostname;
}

/** Downloads a link (following up to 5 redirects, each re-checked) and returns the bytes. */
export async function fetchRemote(raw: string): Promise<{ data: Buffer; mime: string; name: string }> {
  let url = await assertPublicUrl(directDownloadUrl(raw));
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(120_000), headers: { "user-agent": "PamelaOS/1.0" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`The link answered ${res.status}.`);
    const mime = (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
    return { data: await readCapped(res), mime, name: nameFrom(res, url) };
  }
  throw new Error("The link redirected too many times.");
}

export async function importFromUrl(raw: string, meta: { source?: string; description?: string | null; tags?: string[] } = {}) {
  const { data, mime, name } = await fetchRemote(raw);
  return putFile(data, name, mime, { source: meta.source ?? "link", sourceRef: raw, description: meta.description, tags: meta.tags });
}

/* ───────────── OAuth refresh-token helpers ───────────── */

type Cached = { token: string; exp: number };
const g = globalThis as unknown as { __pamelaSourceTokens?: Record<string, Cached>; __pamelaLastSync?: number };
const tokens = (g.__pamelaSourceTokens ??= {});

async function cachedToken(name: string, mint: () => Promise<{ access_token: string; expires_in?: number }>) {
  const hit = tokens[name];
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const t = await mint();
  tokens[name] = { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 };
  return t.access_token;
}

/* ───────────── Google Drive ───────────── */

export async function driveConnected() {
  return !!((await getSecret("GOOGLE_CLIENT_ID")) && (await getSecret("GOOGLE_CLIENT_SECRET")) && (await getSecret("GOOGLE_REFRESH_TOKEN")));
}

async function driveToken() {
  return cachedToken("gdrive", async () => {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: (await getSecret("GOOGLE_CLIENT_ID")) ?? "",
        client_secret: (await getSecret("GOOGLE_CLIENT_SECRET")) ?? "",
        refresh_token: (await getSecret("GOOGLE_REFRESH_TOKEN")) ?? "",
      }),
    });
    if (!res.ok) throw new Error(`Google sign-in failed (${res.status}). Check the Drive keys in Settings.`);
    return res.json();
  });
}

const GOOGLE_EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.drawing": { mime: "image/png", ext: ".png" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" },
};

export async function listDrive(opts: { query?: string; folderId?: string } = {}): Promise<RemoteFile[]> {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = ["trashed = false"];
  if (opts.folderId) q.push(`'${esc(opts.folderId)}' in parents`);
  if (opts.query) q.push(`name contains '${esc(opts.query)}'`);
  const params = new URLSearchParams({
    q: q.join(" and "),
    orderBy: "modifiedTime desc",
    pageSize: "40",
    fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { authorization: `Bearer ${await driveToken()}` } });
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}.`);
  const data = (await res.json()) as { files: { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; webViewLink?: string }[] };
  return data.files.map((f) => ({
    id: f.id,
    name: f.name,
    mime: f.mimeType,
    size: f.size ? Number(f.size) : null,
    modifiedAt: f.modifiedTime ?? null,
    isFolder: f.mimeType === "application/vnd.google-apps.folder",
    link: f.webViewLink,
  }));
}

export async function importFromDrive(fileId: string) {
  const token = await driveToken();
  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType&supportsAllDrives=true`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Google Drive answered ${metaRes.status}.`);
  const meta = (await metaRes.json()) as { id: string; name: string; mimeType: string };
  const exp = GOOGLE_EXPORTS[meta.mimeType];
  if (meta.mimeType.startsWith("application/vnd.google-apps.") && !exp) throw new Error(`“${meta.name}” is a Google ${meta.mimeType.split(".").pop()} and can't be downloaded.`);
  const url = exp
    ? `https://www.googleapis.com/drive/v3/files/${meta.id}/export?mimeType=${encodeURIComponent(exp.mime)}`
    : `https://www.googleapis.com/drive/v3/files/${meta.id}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Google Drive download failed (${res.status}).`);
  const name = exp && !meta.name.endsWith(exp.ext) ? `${meta.name}${exp.ext}` : meta.name;
  return putFile(await readCapped(res), name, exp?.mime ?? meta.mimeType, { source: "gdrive", sourceRef: `gdrive:${meta.id}` });
}

/* ───────────── Dropbox ───────────── */

export async function dropboxConnected() {
  return !!((await getSecret("DROPBOX_APP_KEY")) && (await getSecret("DROPBOX_APP_SECRET")) && (await getSecret("DROPBOX_REFRESH_TOKEN")));
}

async function dropboxToken() {
  return cachedToken("dropbox", async () => {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: (await getSecret("DROPBOX_REFRESH_TOKEN")) ?? "",
        client_id: (await getSecret("DROPBOX_APP_KEY")) ?? "",
        client_secret: (await getSecret("DROPBOX_APP_SECRET")) ?? "",
      }),
    });
    if (!res.ok) throw new Error(`Dropbox sign-in failed (${res.status}). Check the Dropbox keys in Settings.`);
    return res.json();
  });
}

type DropboxEntry = { ".tag": "file" | "folder" | "deleted"; id: string; name: string; path_display?: string; size?: number; server_modified?: string };

const toRemote = (e: DropboxEntry): RemoteFile => ({
  id: e.id,
  name: e.name,
  mime: e[".tag"] === "folder" ? "folder" : "application/octet-stream",
  size: e.size ?? null,
  modifiedAt: e.server_modified ?? null,
  isFolder: e[".tag"] === "folder",
});

export async function listDropbox(opts: { query?: string; path?: string } = {}): Promise<RemoteFile[]> {
  const headers = { authorization: `Bearer ${await dropboxToken()}`, "content-type": "application/json" };
  if (opts.query) {
    const res = await fetch("https://api.dropboxapi.com/2/files/search_v2", { method: "POST", headers, body: JSON.stringify({ query: opts.query, options: { max_results: 40 } }) });
    if (!res.ok) throw new Error(`Dropbox answered ${res.status}.`);
    const data = (await res.json()) as { matches: { metadata: { metadata: DropboxEntry } }[] };
    return data.matches.map((m) => toRemote(m.metadata.metadata));
  }
  const path = opts.path && opts.path !== "/" ? opts.path : "";
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", { method: "POST", headers, body: JSON.stringify({ path, limit: 100 }) });
  if (!res.ok) throw new Error(`Dropbox answered ${res.status}.`);
  const data = (await res.json()) as { entries: DropboxEntry[] };
  return data.entries
    .filter((e) => e[".tag"] !== "deleted")
    .map(toRemote)
    .sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const mimeFromName = (name: string) => MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export async function importFromDropbox(id: string) {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { authorization: `Bearer ${await dropboxToken()}`, "Dropbox-API-Arg": JSON.stringify({ path: id }) },
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Dropbox download failed (${res.status}).`);
  const meta = JSON.parse(res.headers.get("dropbox-api-result") ?? "{}") as { id?: string; name?: string };
  const name = meta.name ?? "dropbox-file";
  return putFile(await readCapped(res), name, mimeFromName(name), { source: "dropbox", sourceRef: `dropbox:${meta.id ?? id}` });
}

/* ───────────── Auto-pull folders ───────────── */

const SYNC_EVERY_MS = 10 * 60_000;
const PER_PASS = 5;

/**
 * Pulls new files from the designated Drive folder and Dropbox path into the
 * Library and drops a note in the Command Center inbox for each. Runs from the
 * scheduler at most every 10 minutes per process.
 */
export async function syncSources(force = false) {
  if (!force && g.__pamelaLastSync && Date.now() - g.__pamelaLastSync < SYNC_EVERY_MS) return { skipped: true };
  g.__pamelaLastSync = Date.now();
  const out: Record<string, number | string> = {};
  const db = await getDb();
  const { addInboxItem } = await import("./inbox");

  const pull = async (source: "gdrive" | "dropbox", list: () => Promise<RemoteFile[]>, load: (id: string) => Promise<typeof schema.files.$inferSelect>, idOf: (f: RemoteFile) => string) => {
    const remote = (await list()).filter((f) => !f.isFolder);
    if (!remote.length) return 0;
    const refs = remote.map((f) => `${source}:${idOf(f)}`);
    const seen = new Set(
      (await db.select({ ref: schema.files.sourceRef }).from(schema.files).where(and(eq(schema.files.source, source), inArray(schema.files.sourceRef, refs)))).map((r) => r.ref),
    );
    let n = 0;
    for (const f of remote) {
      if (n >= PER_PASS || seen.has(`${source}:${idOf(f)}`)) continue;
      const file = await load(idOf(f));
      await addInboxItem({ kind: "file", source, title: file.name, fileId: file.id, body: `Pulled in automatically from ${source === "gdrive" ? "Google Drive" : "Dropbox"}.` });
      n++;
    }
    return n;
  };

  const folderId = await getSecret("GDRIVE_INBOX_FOLDER_ID");
  if (folderId && (await driveConnected())) {
    try {
      out.gdrive = await pull("gdrive", () => listDrive({ folderId }), importFromDrive, (f) => f.id);
    } catch (e) {
      out.gdrive = (e as Error).message;
    }
  }
  const path = await getSecret("DROPBOX_INBOX_PATH");
  if (path && (await dropboxConnected())) {
    try {
      out.dropbox = await pull("dropbox", () => listDropbox({ path }), importFromDropbox, (f) => f.id);
    } catch (e) {
      out.dropbox = (e as Error).message;
    }
  }
  return out;
}
