import { and, asc, eq, lte } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { EventRow } from "./events";
import { createApproval, personalize } from "./approvals";
import { contactName } from "./crm";

/** Enrolls a contact; returns false if they're already in the sequence. */
export async function enroll(sequenceId: string, contactId: string): Promise<boolean> {
  const db = await getDb();
  const [first] = await db.select().from(schema.sequenceSteps).where(eq(schema.sequenceSteps.sequenceId, sequenceId)).orderBy(asc(schema.sequenceSteps.position)).limit(1);
  const rows = await db
    .insert(schema.enrollments)
    .values({ sequenceId, contactId, nextStep: 0, nextRunAt: new Date(Date.now() + (first?.delayMinutes ?? 0) * 60_000) })
    .onConflictDoNothing()
    .returning();
  return rows.length > 0;
}

/** Sequences with an event trigger auto-enroll the event's contact. */
export async function autoEnroll(event: EventRow) {
  const contactId = event.payload?.contactId;
  if (typeof contactId !== "string") return;
  const db = await getDb();
  const seqs = await db.select().from(schema.sequences).where(and(eq(schema.sequences.trigger, event.type), eq(schema.sequences.active, true)));
  for (const s of seqs) {
    const filterOk = Object.entries(s.triggerFilter ?? {}).every(([k, v]) => !v || String(event.payload?.[k] ?? "") === v);
    if (filterOk) await enroll(s.id, contactId);
  }
}

/**
 * Called by the scheduler. Each due step becomes an approval (sequences never
 * send on their own) and the enrollment advances to the next step.
 */
export async function processDueEnrollments(now = new Date()) {
  const db = await getDb();
  const due = await db
    .select()
    .from(schema.enrollments)
    .where(and(eq(schema.enrollments.status, "active"), lte(schema.enrollments.nextRunAt, now)))
    .limit(100);
  let drafted = 0;
  for (const en of due) {
    const steps = await db.select().from(schema.sequenceSteps).where(eq(schema.sequenceSteps.sequenceId, en.sequenceId)).orderBy(asc(schema.sequenceSteps.position));
    const step = steps[en.nextStep];
    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, en.contactId));
    const [seq] = await db.select().from(schema.sequences).where(eq(schema.sequences.id, en.sequenceId));
    if (!step || !contact || !seq || contact.doNotContact) {
      await db.update(schema.enrollments).set({ status: "completed", nextRunAt: null }).where(eq(schema.enrollments.id, en.id));
      continue;
    }
    // Claim this step by advancing the enrollment first (conditional on the step we
    // read), so concurrent scheduler runs can't draft the same step twice.
    const next = steps[en.nextStep + 1];
    const [claimed] = await db
      .update(schema.enrollments)
      .set(next ? { nextStep: en.nextStep + 1, nextRunAt: new Date(now.getTime() + next.delayMinutes * 60_000) } : { nextStep: en.nextStep + 1, status: "completed", nextRunAt: null })
      .where(and(eq(schema.enrollments.id, en.id), eq(schema.enrollments.status, "active"), eq(schema.enrollments.nextStep, en.nextStep)))
      .returning({ id: schema.enrollments.id });
    if (!claimed) continue;
    const body = personalize(step.body, contact);
    if (step.channel === "sms" && contact.phone) {
      await createApproval({ kind: "sms", title: `${seq.name} · step ${en.nextStep + 1} → ${contactName(contact)}`, payload: { to: contact.phone, body }, contactId: contact.id, createdBy: "sequence", subjectType: "sequence", subjectId: seq.id });
      drafted++;
    } else if (step.channel === "email" && contact.email) {
      await createApproval({
        kind: "email",
        title: `${seq.name} · step ${en.nextStep + 1} → ${contactName(contact)}`,
        payload: { to: contact.email, subject: personalize(step.subject ?? seq.name, contact), body },
        contactId: contact.id,
        createdBy: "sequence",
        subjectType: "sequence",
        subjectId: seq.id,
      });
      drafted++;
    }
  }
  return drafted;
}
