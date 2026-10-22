"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ActionItem } from "@/lib/db/schema";
import { createTasksForMeeting } from "@/lib/modules/meetings";
import { processMeetingNow } from "@/lib/modules/meetings-run";
import { draftInHerVoice } from "@/lib/rj/voice";
import { createApproval } from "@/lib/approvals";
import { contactName } from "@/lib/crm";
import { requireSession } from "@/lib/auth";

const path = (id: string) => `/meetings/${id}`;

export async function saveSummary(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  await db
    .update(schema.meetings)
    .set({
      title: String(form.get("title") || "Meeting"),
      summary: String(form.get("summary") || ""),
      contactId: String(form.get("contactId") || "") || null,
      dealId: String(form.get("dealId") || "") || null,
    })
    .where(eq(schema.meetings.id, id));
  revalidatePath(path(id));
}

export async function saveActionItems(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id));
  if (!m) return;
  const texts = form.getAll("text").map(String);
  const owners = form.getAll("owner").map(String);
  const dues = form.getAll("due").map(String);
  const taskIds = form.getAll("taskId").map(String);
  const items: ActionItem[] = texts
    .map((text, i) => ({ text: text.trim(), owner: owners[i] || undefined, due: dues[i] || undefined, taskId: taskIds[i] || undefined }))
    .filter((i) => i.text);
  const extra = String(form.get("newItem") || "").trim();
  if (extra) items.push({ text: extra });
  await db.update(schema.meetings).set({ actionItems: items }).where(eq(schema.meetings.id, id));
  revalidatePath(path(id));
}

export async function createTasks(id: string) {
  await requireSession();
  await createTasksForMeeting(id);
  revalidatePath(path(id));
}

export async function renameSpeaker(id: string, form: FormData) {
  await requireSession();
  const from = String(form.get("from") || "");
  const to = String(form.get("to") || "").trim();
  if (!from || !to) return;
  const db = await getDb();
  const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id));
  if (!m) return;
  await db
    .update(schema.meetings)
    .set({
      segments: m.segments.map((s) => (s.speaker === from ? { ...s, speaker: to } : s)),
      speakers: [...new Set(m.speakers.map((s) => (s === from ? to : s)))],
      actionItems: m.actionItems.map((a) => (a.owner === from ? { ...a, owner: to } : a)),
    })
    .where(eq(schema.meetings.id, id));
  revalidatePath(path(id));
}

export async function reprocess(id: string) {
  await requireSession();
  await processMeetingNow(id, { reprocess: true });
  revalidatePath(path(id));
}

export async function draftFollowUp(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id));
  if (!m?.contactId) redirect(`${path(id)}?error=${encodeURIComponent("Link this meeting to a contact first.")}`);
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, m!.contactId!));
  if (!c?.email) redirect(`${path(id)}?error=${encodeURIComponent("That contact has no email address.")}`);
  const extra = String(form.get("instructions") || "");
  const draft = await draftInHerVoice({
    channel: "email",
    contact: c,
    instructions: `Send a warm follow-up after our meeting "${m!.title}". Recap what we discussed and the next steps. ${extra}`,
    context: `Summary: ${m!.summary ?? ""}\nAction items:\n${m!.actionItems.map((a) => `- ${a.text}${a.owner ? ` (${a.owner})` : ""}${a.due ? ` due ${a.due}` : ""}`).join("\n")}`,
  });
  await createApproval({
    kind: "email",
    title: `Follow-up to ${contactName(c)}: ${draft.subject}`,
    summary: `After meeting “${m!.title}”`,
    payload: { to: c.email!, subject: draft.subject, body: draft.body },
    contactId: c.id,
    subjectType: "meeting",
    subjectId: m!.id,
    createdBy: "rj",
  });
  redirect("/approvals");
}

export async function deleteMeeting(id: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.meetings).where(eq(schema.meetings.id, id));
  redirect("/meetings");
}
