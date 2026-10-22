"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { putFile } from "@/lib/storage";
import { createApproval } from "@/lib/approvals";
import { aiText } from "@/lib/ai";
import { herVoiceSystem } from "@/lib/rj/voice";
import { generateInCanva } from "@/lib/modules/design";
import { TEMPLATES } from "@/components/studio/designTemplates";

export async function createDesign(form: FormData) {
  const t = TEMPLATES.find((x) => x.key === form.get("templateKey")) ?? TEMPLATES[0];
  const db = await getDb();
  const [d] = await db
    .insert(schema.designs)
    .values({ title: String(form.get("title") || t.name), templateKey: t.key, format: t.format, fields: {} })
    .returning();
  redirect(`/studio/design/${d.id}`);
}

async function getDesign(id: string) {
  const db = await getDb();
  const [d] = await db.select().from(schema.designs).where(eq(schema.designs.id, id));
  if (!d) throw new Error("Design not found");
  return d;
}

export async function saveDesign(id: string, form: FormData) {
  const d = await getDesign(id);
  const t = TEMPLATES.find((x) => x.key === d.templateKey) ?? TEMPLATES[0];
  const fields: Record<string, string> = { ...d.fields };
  for (const f of t.fields) if (f !== "photo") fields[f] = String(form.get(f) ?? "");
  const db = await getDb();
  // Any edit invalidates the previous export so a stale image can't be published.
  await db
    .update(schema.designs)
    .set({ title: String(form.get("title") || d.title), fields, exportFileId: null, status: "draft", updatedAt: new Date() })
    .where(eq(schema.designs.id, id));
  revalidatePath(`/studio/design/${id}`);
}

export async function uploadPhoto(id: string, form: FormData) {
  const file = form.get("photo");
  if (!(file instanceof File) || !file.size || !file.type.startsWith("image/")) return;
  const stored = await putFile(Buffer.from(await file.arrayBuffer()), file.name, file.type);
  const d = await getDesign(id);
  const db = await getDb();
  await db.update(schema.designs).set({ fields: { ...d.fields, photoFileId: stored.id }, exportFileId: null, updatedAt: new Date() }).where(eq(schema.designs.id, id));
  revalidatePath(`/studio/design/${id}`);
}

export async function canvaGenerate(id: string) {
  await generateInCanva(id);
  revalidatePath(`/studio/design/${id}`);
}

export async function suggestCaption(id: string) {
  const d = await getDesign(id);
  const r = await aiText(
    "drafting",
    await herVoiceSystem(),
    `Write an Instagram/Facebook caption (2–4 short sentences, at most 2 hashtags) for this graphic.\nTemplate: ${d.templateKey}\nHeadline: ${d.fields.headline ?? ""}\nBody: ${d.fields.body ?? ""}\nDate: ${d.fields.date ?? ""}\nCall to action: ${d.fields.cta ?? ""}\nReturn only the caption.`,
    400,
  );
  const caption = r?.text || [d.fields.headline, d.fields.body, d.fields.date, d.fields.cta, "💜 A Cup of Compassion · (323) 943-ACUP"].filter(Boolean).join("\n");
  const db = await getDb();
  await db.update(schema.designs).set({ fields: { ...d.fields, caption } }).where(eq(schema.designs.id, id));
  revalidatePath(`/studio/design/${id}`);
}

export async function publishDesign(id: string, form: FormData) {
  const d = await getDesign(id);
  if (!d.exportFileId) throw new Error("Export the design first.");
  const platforms = form.getAll("platforms").map(String).filter((p): p is "instagram" | "facebook" => p === "instagram" || p === "facebook");
  if (!platforms.length) throw new Error("Pick at least one platform.");
  const caption = String(form.get("caption") ?? "");
  const db = await getDb();
  await db.update(schema.designs).set({ fields: { ...d.fields, caption }, status: "awaiting_approval" }).where(eq(schema.designs.id, id));
  await createApproval({
    kind: "design_publish",
    title: `Publish “${d.title}” to ${platforms.join(" + ")}`,
    payload: { designId: id, platforms, caption },
    subjectType: "design",
    subjectId: id,
  });
  redirect("/approvals");
}

export async function deleteDesign(id: string) {
  const db = await getDb();
  await db.delete(schema.designs).where(eq(schema.designs.id, id));
  redirect("/studio/design");
}
