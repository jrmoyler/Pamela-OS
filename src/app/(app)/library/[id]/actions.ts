"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { deleteFile, getFileRecord, isTextFile, putFile, readFile, replaceFileContent } from "@/lib/storage";
import { docxParagraphs, docxToMarkdown } from "@/lib/docx";

const back = (id: string, msg: string, error = false) => redirect(`/library/${id}?${error ? "error" : "ok"}=${encodeURIComponent(msg)}`);

export async function saveDetails(id: string, form: FormData) {
  await requireSession();
  const name = String(form.get("name") ?? "").trim();
  if (!name) back(id, "A file needs a name.", true);
  const description = String(form.get("description") ?? "").trim() || null;
  const tags = String(form.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const db = await getDb();
  await db.update(schema.files).set({ name, description, tags }).where(eq(schema.files.id, id));
  revalidatePath("/library");
  back(id, "Details saved.");
}

/** Called from the editor; returns instead of redirecting so unsaved typing isn't lost on error. */
export async function saveContent(id: string, text: string): Promise<{ ok: true } | { error: string }> {
  await requireSession();
  const rec = await getFileRecord(id);
  if (!rec) return { error: "This file no longer exists." };
  if (!isTextFile(rec.mime, rec.name)) return { error: "This kind of file can't be edited as text." };
  try {
    await replaceFileContent(id, Buffer.from(text, "utf8"));
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/library");
  revalidatePath(`/library/${id}`);
  return { ok: true };
}

/** Word files can't be written back, so this makes a Markdown copy she can edit. */
export async function editableCopy(id: string) {
  await requireSession();
  const f = await readFile(id);
  const rec = await getFileRecord(id);
  const paras = f && docxParagraphs(f.data);
  if (!rec || !paras) back(id, "Couldn't read this document.", true);
  const copy = await putFile(Buffer.from(docxToMarkdown(paras!), "utf8"), rec!.name.replace(/\.docx$/i, "") + ".md", "text/markdown", {
    source: rec!.source,
    description: rec!.description,
    tags: rec!.tags,
  });
  revalidatePath("/library");
  redirect(`/library/${copy.id}?ok=${encodeURIComponent("Editable copy made. The original Word file is still in the Library.")}`);
}

export async function removeFile(id: string) {
  await requireSession();
  await deleteFile(id);
  revalidatePath("/library");
  redirect(`/library?tab=all&ok=${encodeURIComponent("File deleted.")}`);
}
