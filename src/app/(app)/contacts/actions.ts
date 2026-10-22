"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { findOrCreateContact, logActivity, normalizePhone, contactName } from "@/lib/crm";
import { emit } from "@/lib/events";
import { createApproval } from "@/lib/approvals";
import { draftInHerVoice } from "@/lib/rj/voice";
import { requireSession } from "@/lib/auth";

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export async function createContact(form: FormData) {
  await requireSession();
  const { contact, created } = await findOrCreateContact({
    firstName: String(form.get("firstName") ?? ""),
    lastName: String(form.get("lastName") ?? ""),
    email: String(form.get("email") ?? "") || null,
    phone: String(form.get("phone") ?? "") || null,
    company: String(form.get("company") ?? "") || null,
    source: "manual",
    tags: list(form.get("tags")),
    relationshipTypes: form.getAll("relationshipTypes").map(String),
  });
  if (created) {
    await logActivity({ type: "system", contactId: contact.id, title: "Contact created" });
    await emit("contact.created", { contactId: contact.id, source: "manual" }, "crm");
  }
  redirect(`/contacts/${contact.id}`);
}

export async function updateContact(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  await db
    .update(schema.contacts)
    .set({
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
      email: String(form.get("email") ?? "").trim().toLowerCase() || null,
      phone: normalizePhone(String(form.get("phone") ?? "")),
      company: String(form.get("company") ?? "") || null,
      title: String(form.get("title") ?? "") || null,
      tags: list(form.get("tags")),
      relationshipTypes: form.getAll("relationshipTypes").map(String),
      notes: String(form.get("notes") ?? "") || null,
      doNotContact: form.get("doNotContact") === "on",
      updatedAt: new Date(),
    })
    .where(eq(schema.contacts.id, id));
  revalidatePath(`/contacts/${id}`);
}

export async function addNote(id: string, form: FormData) {
  await requireSession();
  const body = String(form.get("body") ?? "").trim();
  if (!body) return;
  const type = String(form.get("type") || "note");
  const titles: Record<string, string> = { note: "Note", call: "Call logged", meeting: "Meeting logged", sms: "Text logged", email: "Email logged" };
  await logActivity({ type, contactId: id, title: titles[type] ?? "Note", body, direction: type === "note" ? "internal" : "outbound" });
  revalidatePath(`/contacts/${id}`);
}

export async function deleteContact(id: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.contacts).where(eq(schema.contacts.id, id));
  redirect("/contacts");
}

/** RJ drafts in Pamela's voice → lands in Approvals, never sent directly. */
export async function draftMessage(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, id));
  if (!c) return;
  const channel = form.get("channel") === "sms" ? "sms" : "email";
  const instructions = String(form.get("instructions") ?? "").trim() || "Check in warmly and see how they're doing.";
  const draft = await draftInHerVoice({ channel, instructions, contact: c });
  if (channel === "sms") {
    if (!c.phone) throw new Error("This contact has no phone number.");
    await createApproval({ kind: "sms", title: `Text to ${contactName(c)}`, payload: { to: c.phone, body: draft.body }, contactId: c.id, createdBy: "rj" });
  } else {
    if (!c.email) throw new Error("This contact has no email.");
    await createApproval({ kind: "email", title: `Email to ${contactName(c)}: ${draft.subject}`, payload: { to: c.email, subject: draft.subject, body: draft.body }, contactId: c.id, createdBy: "rj" });
  }
  redirect("/approvals");
}

export async function addDealForContact(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  const pipelineId = String(form.get("pipelineId") || "");
  if (!pipelineId) return; // no pipelines yet — an empty id would make the uuid query throw
  const [stage] = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.pipelineId, pipelineId)).orderBy(schema.pipelineStages.position).limit(1);
  if (!stage) return;
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, id));
  if (!c) return;
  const [deal] = await db
    .insert(schema.deals)
    .values({ pipelineId, stageId: stage.id, contactId: id, title: String(form.get("title") || contactName(c)), valueCents: Math.round(Number(form.get("value") || 0) * 100) })
    .returning();
  await logActivity({ type: "system", contactId: id, dealId: deal.id, title: `Added to pipeline · ${stage.name}` });
  await emit("deal.created", { dealId: deal.id, pipelineId, contactId: id }, "crm");
  revalidatePath(`/contacts/${id}`);
}
