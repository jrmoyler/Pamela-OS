"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { campaignAudience, createApproval } from "@/lib/approvals";
import { draftInHerVoice } from "@/lib/rj/voice";
import { enroll } from "@/lib/sequences";
import { requireSession } from "@/lib/auth";

const splitList = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function audienceFrom(form: FormData) {
  return [...new Set([...splitList(form.get("tags")), ...form.getAll("rel").map(String)])];
}

export async function countAudience(tags: string[], channel: string) {
  await requireSession();
  return (await campaignAudience(tags, channel)).length;
}

/* ───────────── Broadcasts ───────────── */

export async function createCampaign(form: FormData) {
  await requireSession();
  const db = await getDb();
  const [c] = await db
    .insert(schema.campaigns)
    .values({ name: String(form.get("name") || "New campaign"), channel: form.get("channel") === "sms" ? "sms" : "email" })
    .returning();
  redirect(`/campaigns/${c.id}`);
}

export async function saveCampaign(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  await db
    .update(schema.campaigns)
    .set({
      name: String(form.get("name") || "Campaign"),
      channel: form.get("channel") === "sms" ? "sms" : "email",
      subject: String(form.get("subject") ?? "") || null,
      body: String(form.get("body") ?? ""),
      audienceTags: audienceFrom(form),
    })
    .where(and(eq(schema.campaigns.id, id), eq(schema.campaigns.status, "draft")));
  revalidatePath(`/campaigns/${id}`);
}

export async function rjDraftCampaign(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  if (!c || c.status !== "draft") return;
  const instructions = String(form.get("instructions") || "").trim() || `Write a broadcast for "${c.name}".`;
  const draft = await draftInHerVoice({
    channel: c.channel === "sms" ? "sms" : "email",
    instructions,
    context: "This is a broadcast to many people. Greet them with the literal placeholder {{first_name}} instead of a name.",
  });
  await db
    .update(schema.campaigns)
    .set({ body: draft.body.replace(/^Hi friend\b/, "Hi {{first_name}}"), subject: c.channel === "email" ? draft.subject : c.subject })
    .where(eq(schema.campaigns.id, id));
  revalidatePath(`/campaigns/${id}`);
}

/** Broadcasts never go out without Pamela's approval. */
export async function sendCampaign(id: string, form: FormData) {
  await requireSession();
  await saveCampaign(id, form);
  const db = await getDb();
  const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  if (!c || c.status !== "draft") return;
  if (!c.body.trim()) throw new Error("Write the message first.");
  const audience = await campaignAudience(c.audienceTags, c.channel);
  if (!audience.length) throw new Error("Nobody matches this audience yet.");
  await createApproval({
    kind: "campaign_send",
    title: `Send “${c.name}” to ${audience.length} ${audience.length === 1 ? "person" : "people"} by ${c.channel === "sms" ? "text" : "email"}`,
    summary: c.audienceTags.length ? `Audience: ${c.audienceTags.join(", ")}` : "Audience: everyone reachable",
    // subject/body are included so the approval gate's brand check sees the copy.
    payload: { campaignId: c.id, subject: c.subject ?? "", body: c.body } as { campaignId: string },
    subjectType: "campaign",
    subjectId: c.id,
  });
  await db.update(schema.campaigns).set({ status: "awaiting_approval", recipients: audience.length }).where(eq(schema.campaigns.id, id));
  redirect("/approvals");
}

export async function duplicateCampaign(id: string) {
  await requireSession();
  const db = await getDb();
  const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  if (!c) return;
  const [copy] = await db
    .insert(schema.campaigns)
    .values({ name: `${c.name} (copy)`, channel: c.channel, subject: c.subject, body: c.body, audienceTags: c.audienceTags })
    .returning();
  redirect(`/campaigns/${copy.id}`);
}

export async function deleteCampaign(id: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.campaigns).where(eq(schema.campaigns.id, id));
  redirect("/campaigns");
}

/* ───────────── Sequences ───────────── */

export async function createSequence(form: FormData) {
  await requireSession();
  const db = await getDb();
  const [s] = await db
    .insert(schema.sequences)
    .values({ name: String(form.get("name") || "New sequence"), trigger: String(form.get("trigger") || "") || null, active: false })
    .returning();
  await db.insert(schema.sequenceSteps).values({ sequenceId: s.id, position: 0, delayMinutes: 0, channel: "email", subject: "Welcome", body: "Hi {{first_name}},\n\n" });
  redirect(`/campaigns/sequences/${s.id}`);
}

export async function saveSequence(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  const key = String(form.get("filterKey") || "").trim();
  const value = String(form.get("filterValue") || "").trim();
  await db
    .update(schema.sequences)
    .set({
      name: String(form.get("name") || "Sequence"),
      trigger: String(form.get("trigger") || "") || null,
      triggerFilter: key && value ? { [key]: value } : {},
      active: form.get("active") === "on",
    })
    .where(eq(schema.sequences.id, id));
  revalidatePath(`/campaigns/sequences/${id}`);
}

async function steps(id: string) {
  const db = await getDb();
  return db.select().from(schema.sequenceSteps).where(eq(schema.sequenceSteps.sequenceId, id)).orderBy(asc(schema.sequenceSteps.position));
}

const toMinutes = (form: FormData) => Math.max(0, Math.round(Number(form.get("delay") || 0) * Number(form.get("unit") || 1)));

export async function addStep(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  const existing = await steps(id);
  await db.insert(schema.sequenceSteps).values({
    sequenceId: id,
    position: existing.length,
    delayMinutes: toMinutes(form) || 1440,
    channel: form.get("channel") === "sms" ? "sms" : "email",
    subject: form.get("channel") === "sms" ? null : "",
    body: "Hi {{first_name}},\n\n",
  });
  revalidatePath(`/campaigns/sequences/${id}`);
}

export async function saveStep(id: string, stepId: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  await db
    .update(schema.sequenceSteps)
    .set({
      delayMinutes: toMinutes(form),
      channel: form.get("channel") === "sms" ? "sms" : "email",
      subject: String(form.get("subject") ?? "") || null,
      body: String(form.get("body") ?? ""),
    })
    .where(and(eq(schema.sequenceSteps.id, stepId), eq(schema.sequenceSteps.sequenceId, id)));
  revalidatePath(`/campaigns/sequences/${id}`);
}

async function renumber(id: string, ordered: { id: string }[]) {
  const db = await getDb();
  for (const [i, s] of ordered.entries()) await db.update(schema.sequenceSteps).set({ position: i }).where(eq(schema.sequenceSteps.id, s.id));
  revalidatePath(`/campaigns/sequences/${id}`);
}

export async function moveStep(id: string, stepId: string, dir: number) {
  await requireSession();
  const list = await steps(id);
  const i = list.findIndex((s) => s.id === stepId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await renumber(id, list);
}

export async function deleteStep(id: string, stepId: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.sequenceSteps).where(eq(schema.sequenceSteps.id, stepId));
  await renumber(id, await steps(id));
}

export async function manualEnroll(id: string, form: FormData) {
  await requireSession();
  const contactId = String(form.get("contactId") || "");
  if (contactId) await enroll(id, contactId);
  revalidatePath(`/campaigns/sequences/${id}`);
}

export async function stopEnrollment(id: string, enrollmentId: string) {
  await requireSession();
  const db = await getDb();
  await db.update(schema.enrollments).set({ status: "stopped", nextRunAt: null }).where(eq(schema.enrollments.id, enrollmentId));
  revalidatePath(`/campaigns/sequences/${id}`);
}

export async function deleteSequence(id: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.sequences).where(eq(schema.sequences.id, id));
  redirect("/campaigns/sequences");
}
