"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { and, eq, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { putFile } from "@/lib/storage";
import { enqueue, runPendingJobsInline } from "@/lib/jobs";
import { createApproval } from "@/lib/approvals";
import { contactName, normalizePhone } from "@/lib/crm";
import { aiText } from "@/lib/ai";
import { herVoiceSystem } from "@/lib/rj/voice";
import { createCloneWithProvider } from "@/lib/modules/voice";
import { requireSession } from "@/lib/auth";

const PATH = "/studio/voice";

export async function createClone(form: FormData) {
  await requireSession();
  if (form.get("consent") !== "on") throw new Error("Please confirm consent before creating a voice clone.");
  const files = form.getAll("samples").filter((f): f is File => f instanceof File && f.size > 0);
  const sampleFileIds: string[] = [];
  for (const f of files) sampleFileIds.push((await putFile(Buffer.from(await f.arrayBuffer()), f.name, f.type || "audio/mpeg")).id);
  const db = await getDb();
  await db.insert(schema.voiceClones).values({
    name: String(form.get("name") || "Pamela"),
    provider: form.get("provider") === "chatterbox" ? "chatterbox" : "elevenlabs",
    sampleFileIds,
    consentConfirmedAt: new Date(),
  });
  revalidatePath(PATH);
}

export async function activateClone(id: string) {
  await requireSession();
  try {
    await createCloneWithProvider(id);
  } finally {
    revalidatePath(PATH);
  }
}

export async function deleteClone(id: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.voiceClones).where(eq(schema.voiceClones.id, id));
  revalidatePath(PATH);
}

export async function createDraft(form: FormData) {
  await requireSession();
  const db = await getDb();
  let script = String(form.get("script") || "").trim();
  const contactId = String(form.get("contactId") || "") || null;
  if (form.get("assist") === "1") {
    const [c] = contactId ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)) : [];
    const r = await aiText(
      "drafting",
      await herVoiceSystem(),
      `Write a short spoken voice message (30–60 seconds read aloud, no stage directions, no emojis) from Pamela${c ? ` to ${contactName(c)}` : ""}. Purpose: ${form.get("purpose")}. What it should say: ${script || "a warm check-in"}. Return only the words to speak.`,
      500,
    );
    if (r) script = r.text;
  }
  if (!script) throw new Error("Write a script (or describe it and let RJ write it).");
  await db.insert(schema.voiceDrafts).values({
    voiceCloneId: String(form.get("voiceCloneId") || "") || null,
    contactId,
    purpose: String(form.get("purpose") || "voice_note"),
    script,
  });
  revalidatePath(PATH);
}

export async function updateScript(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  // Audio under a pending or approved send must stay exactly what Pamela approved.
  const editable = and(eq(schema.voiceDrafts.id, id), notInArray(schema.voiceDrafts.status, ["awaiting_approval", "approved"]));
  // A new script invalidates any rendered audio.
  const [row] = await db.update(schema.voiceDrafts).set({ script: String(form.get("script") || ""), audioFileId: null, status: "draft" }).where(editable).returning();
  if (!row) throw new Error("This voice message is waiting on approval. Reject it in Approvals to edit it.");
  revalidatePath(PATH);
}

export async function renderDraft(id: string) {
  await requireSession();
  const db = await getDb();
  // Audio under a pending or approved send must stay exactly what Pamela approved.
  const editable = and(eq(schema.voiceDrafts.id, id), notInArray(schema.voiceDrafts.status, ["awaiting_approval", "approved"]));
  const [row] = await db.update(schema.voiceDrafts).set({ status: "rendering" }).where(editable).returning();
  if (!row) throw new Error("This voice message is waiting on approval. Reject it in Approvals to re-render it.");
  await enqueue("voice.render", { draftId: id });
  if (process.env.INLINE_JOBS !== "0") after(() => runPendingJobsInline(1, ["voice.render"]).then(() => undefined));
  revalidatePath(PATH);
}

export async function requestSend(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  const [draft] = await db.select().from(schema.voiceDrafts).where(eq(schema.voiceDrafts.id, id));
  if (!draft?.audioFileId) throw new Error("Render or record the audio first.");
  const to = normalizePhone(String(form.get("to") || ""));
  if (!to) throw new Error("Enter a phone number.");
  const channel = form.get("channel") === "call" ? "call" : "sms";
  const [c] = draft.contactId ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, draft.contactId)) : [];
  await createApproval({
    kind: "voice_send",
    title: `Voice ${channel === "call" ? "call drop" : "message"} to ${c ? contactName(c) : to}`,
    summary: draft.script.slice(0, 300),
    payload: { voiceDraftId: id, to, channel },
    contactId: draft.contactId,
    subjectType: "voice_draft",
    subjectId: id,
  });
  await db.update(schema.voiceDrafts).set({ status: "awaiting_approval" }).where(eq(schema.voiceDrafts.id, id));
  redirect("/approvals");
}

export async function deleteDraft(id: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.voiceDrafts).where(eq(schema.voiceDrafts.id, id));
  revalidatePath(PATH);
}
