import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { emit } from "../events";
import { logActivity } from "../crm";
import { putFile } from "../storage";
import { importFromUrl, mimeFromName } from "./sources";
import { attachFileToTask } from "./computer";

export type InboxItem = typeof schema.inboxItems.$inferSelect;

export const SOURCE_LABELS: Record<string, string> = {
  upload: "Upload",
  link: "Link",
  gdrive: "Google Drive",
  dropbox: "Dropbox",
  claude: "Claude",
  chatgpt: "ChatGPT",
  meta: "Meta Muse",
  hermes: "Hermes",
  rj: "RJ",
  other: "Other app",
};

export async function addInboxItem(input: {
  kind: "file" | "note" | "link";
  source: string;
  title: string;
  body?: string | null;
  url?: string | null;
  fileId?: string | null;
  contactId?: string | null;
  agentKeyId?: string | null;
  computerTaskId?: string | null;
}) {
  const db = await getDb();
  const [item] = await db
    .insert(schema.inboxItems)
    .values({ ...input, title: input.title.slice(0, 200) || "Untitled" })
    .returning();
  if (input.contactId) {
    await logActivity({
      contactId: input.contactId,
      type: "note",
      title: `${SOURCE_LABELS[input.source] ?? input.source}: ${item.title}`,
      body: input.body ?? undefined,
      subjectType: "inbox_item",
      subjectId: item.id,
      meta: { source: input.source, fileId: input.fileId ?? null },
    });
  }
  await emit("inbox.received", { inboxItemId: item.id, kind: item.kind, source: item.source, fileId: item.fileId, contactId: item.contactId }, item.source);
  return item;
}

export const MAX_INLINE_BYTES = 20 * 1024 * 1024;

/** A file pushed by an outside agent: inline (base64 or text) or by link the server fetches. */
export async function pushFile(input: {
  source: string;
  agentKeyId?: string | null;
  name?: string;
  mime?: string;
  base64?: string;
  text?: string;
  url?: string;
  description?: string | null;
  tags?: string[];
  contactId?: string | null;
  computerTaskId?: string | null;
}) {
  let file: typeof schema.files.$inferSelect;
  if (input.url) {
    file = await importFromUrl(input.url, { source: input.source, description: input.description, tags: input.tags });
    if (input.name && input.name !== file.name) {
      const db = await getDb();
      [file] = await db.update(schema.files).set({ name: input.name }).where(eq(schema.files.id, file.id)).returning();
    }
  } else {
    const name = input.name?.trim() || (input.text != null ? "note.txt" : "file");
    let data: Buffer;
    if (input.base64 != null) data = Buffer.from(input.base64.replace(/^data:[^,]*,/, ""), "base64");
    else if (input.text != null) data = Buffer.from(input.text, "utf8");
    else throw new Error("Send the file as base64, as text, or as a url.");
    if (data.byteLength > MAX_INLINE_BYTES) throw new Error("File is too large to send inline (20 MB). Send a url instead.");
    if (!data.byteLength) throw new Error("The file is empty.");
    const mime = input.mime || (input.text != null && !/\.\w+$/.test(name) ? "text/plain" : mimeFromName(name));
    file = await putFile(data, name, mime, { source: input.source, description: input.description, tags: input.tags });
  }
  if (input.computerTaskId) await attachFileToTask(input.computerTaskId, file.id);
  const item = await addInboxItem({
    kind: "file",
    source: input.source,
    agentKeyId: input.agentKeyId,
    title: file.name,
    body: input.description ?? null,
    fileId: file.id,
    contactId: input.contactId,
    computerTaskId: input.computerTaskId,
  });
  return { file, item };
}

export async function setInboxStatus(id: string, status: "new" | "filed" | "dismissed") {
  const db = await getDb();
  await db.update(schema.inboxItems).set({ status }).where(eq(schema.inboxItems.id, id));
}
