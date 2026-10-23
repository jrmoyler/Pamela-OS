import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { localDir } from "./localdir";

/**
 * Object storage. Uses Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * are set, otherwise the local ./storage directory (single-VPS deployments).
 */
const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || "pamela-os";
const supabase = () =>
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? { url: process.env.SUPABASE_URL.replace(/\/$/, ""), key: process.env.SUPABASE_SERVICE_ROLE_KEY }
    : null;
let root: string | undefined;
const localRoot = () => (root ??= localDir("storage", process.env.STORAGE_DIR || undefined));

export function kindFromMime(mime: string) {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || mime.startsWith("text/") || /json|xml|msword|officedocument|opendocument|rtf/.test(mime)) return "document";
  return "other";
}

export type FileMeta = { source?: string; sourceRef?: string | null; description?: string | null; tags?: string[] };

async function writeObject(storageKey: string, data: Buffer | Uint8Array, mime: string) {
  const sb = supabase();
  if (sb) {
    const res = await fetch(`${sb.url}/storage/v1/object/${bucket()}/${storageKey}`, {
      method: "POST",
      headers: { authorization: `Bearer ${sb.key}`, "content-type": mime, "x-upsert": "true" },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`storage upload failed: ${res.status} ${await res.text()}`);
  } else {
    const full = path.join(localRoot(), storageKey);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }
}

/** Best effort: a stale object left behind costs storage, not correctness. */
async function removeObject(storageKey: string) {
  const sb = supabase();
  try {
    if (sb) await fetch(`${sb.url}/storage/v1/object/${bucket()}/${storageKey}`, { method: "DELETE", headers: { authorization: `Bearer ${sb.key}` } });
    else await fs.unlink(path.join(localRoot(), storageKey));
  } catch {
    /* already gone */
  }
}

const newKey = (name: string) => `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${path.extname(name).slice(0, 10) || ""}`;

export async function putFile(data: Buffer | Uint8Array, name: string, mime: string, meta: FileMeta = {}) {
  const storageKey = newKey(name);
  await writeObject(storageKey, data, mime);
  const db = await getDb();
  const [row] = await db
    .insert(schema.files)
    .values({
      name,
      mime,
      size: data.byteLength,
      storageKey,
      kind: kindFromMime(mime),
      source: meta.source ?? "upload",
      sourceRef: meta.sourceRef ?? null,
      description: meta.description ?? null,
      tags: meta.tags ?? [],
    })
    .returning();
  return row;
}

/**
 * Saves new contents for an existing file. Writes to a fresh key so cached
 * copies of the old version (see fileVersionUrl) are never served as current.
 */
export async function replaceFileContent(id: string, data: Buffer | Uint8Array, mime?: string) {
  const rec = await getFileRecord(id);
  if (!rec) throw new Error("File not found.");
  const type = mime ?? rec.mime;
  const storageKey = newKey(rec.name);
  await writeObject(storageKey, data, type);
  const db = await getDb();
  const [row] = await db
    .update(schema.files)
    .set({ storageKey, size: data.byteLength, mime: type, kind: kindFromMime(type) })
    .where(eq(schema.files.id, id))
    .returning();
  await removeObject(rec.storageKey);
  return row;
}

export async function deleteFile(id: string) {
  const rec = await getFileRecord(id);
  if (!rec) return;
  const db = await getDb();
  await db.delete(schema.files).where(eq(schema.files.id, id));
  await removeObject(rec.storageKey);
}

export async function getFileRecord(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id));
  return row ?? null;
}

export async function readFile(id: string): Promise<{ data: Buffer; mime: string; name: string } | null> {
  const rec = await getFileRecord(id);
  if (!rec) return null;
  const sb = supabase();
  if (sb) {
    const res = await fetch(`${sb.url}/storage/v1/object/${bucket()}/${rec.storageKey}`, {
      headers: { authorization: `Bearer ${sb.key}` },
    });
    if (!res.ok) return null;
    return { data: Buffer.from(await res.arrayBuffer()), mime: rec.mime, name: rec.name };
  }
  try {
    return { data: await fs.readFile(path.join(localRoot(), rec.storageKey)), mime: rec.mime, name: rec.name };
  } catch {
    return null;
  }
}

/** In-app URL for a stored file (served by the authenticated /api/files route). */
export const fileUrl = (id: string) => `/api/files/${id}`;

/** Same, but changes whenever the contents do, so an edited file never shows a cached old copy. */
export const fileVersionUrl = (f: { id: string; storageKey: string }) => `/api/files/${f.id}?v=${encodeURIComponent(path.basename(f.storageKey, path.extname(f.storageKey)).slice(0, 8))}`;

const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "html", "htm", "xml", "yaml", "yml", "css", "js", "ts", "log", "ics", "vcf", "svg"]);

/** Files the Library can open in its text editor. */
export function isTextFile(mime: string, name: string) {
  if (mime.startsWith("text/")) return true;
  if (/^application\/(json|xml|javascript|x-yaml|yaml|x-ndjson)\b/.test(mime) || mime === "image/svg+xml") return true;
  return TEXT_EXT.has(name.split(".").pop()?.toLowerCase() ?? "") && (mime === "application/octet-stream" || mime === "");
}

export const isDocx = (mime: string, name: string) =>
  mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(name);
