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
  if (mime === "application/pdf" || mime.startsWith("text/")) return "document";
  return "other";
}

export type FileMeta = { source?: string; sourceRef?: string | null; description?: string | null; tags?: string[] };

export async function putFile(data: Buffer | Uint8Array, name: string, mime: string, meta: FileMeta = {}) {
  const ext = path.extname(name).slice(0, 10) || "";
  const storageKey = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${ext}`;
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
