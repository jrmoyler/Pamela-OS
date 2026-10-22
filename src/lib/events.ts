import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "./db";

/**
 * The glue. Every module emits events here; automations and sequences react.
 * Each event is persisted, and every automation run is logged with its steps,
 * so failures are always visible on the Automations page.
 */
export const EVENT_CATALOG: { type: string; label: string; fields: string[] }[] = [
  { type: "contact.created", label: "New contact added", fields: ["contactId", "source"] },
  { type: "lead.captured", label: "Lead captured (form, DM or call)", fields: ["contactId", "source", "formId", "triggerId"] },
  { type: "form.submitted", label: "Form submitted", fields: ["formId", "formName", "contactId", "data"] },
  { type: "booking.created", label: "Booking made", fields: ["bookingId", "contactId", "startsAt", "source", "bookingType"] },
  { type: "booking.cancelled", label: "Booking cancelled", fields: ["bookingId", "contactId"] },
  { type: "call.completed", label: "Receptionist call finished", fields: ["callId", "contactId", "disposition", "urgency", "summary"] },
  { type: "sms.received", label: "Text message received", fields: ["contactId", "from", "body"] },
  { type: "meeting.processed", label: "Meeting summarised", fields: ["meetingId", "contactId", "actionItems"] },
  { type: "deal.created", label: "Deal created", fields: ["dealId", "pipelineId", "contactId"] },
  { type: "deal.stage_changed", label: "Deal moved stage", fields: ["dealId", "pipelineId", "stageName", "contactId"] },
  { type: "task.created", label: "Task created", fields: ["taskId", "contactId", "source"] },
  { type: "task.completed", label: "Task completed", fields: ["taskId", "contactId"] },
  { type: "social.comment", label: "Social comment received", fields: ["platform", "text", "contactId", "triggerId"] },
  { type: "social.dm", label: "Social DM received", fields: ["platform", "text", "contactId"] },
  { type: "payment.succeeded", label: "Payment received", fields: ["paymentId", "contactId", "amountCents"] },
  { type: "video.processed", label: "Video clips ready", fields: ["videoId", "clipCount"] },
  { type: "song.generated", label: "Song draft ready", fields: ["songId"] },
  { type: "approval.requested", label: "Draft waiting for approval", fields: ["approvalId", "kind", "contactId"] },
  { type: "approval.executed", label: "Approved item sent", fields: ["approvalId", "kind", "contactId"] },
  { type: "approval.rejected", label: "Draft rejected", fields: ["approvalId", "kind"] },
  { type: "approval.failed", label: "Approved item failed to send", fields: ["approvalId", "kind", "error"] },
];

export type EventRow = typeof schema.events.$inferSelect;

export async function emit(type: string, payload: Record<string, unknown> = {}, source = "system"): Promise<EventRow> {
  const db = await getDb();
  const [event] = await db.insert(schema.events).values({ type, payload, source }).returning();
  try {
    await dispatch(event);
  } catch (e) {
    // Dispatch failures are recorded in automation_runs; never break the caller.
    console.error("[events] dispatch failed", type, e);
  }
  return event;
}

async function dispatch(event: EventRow) {
  const db = await getDb();
  const { runAutomation } = await import("./automations");
  const { autoEnroll } = await import("./sequences");
  const matches = await db
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.trigger, event.type), eq(schema.automations.enabled, true)));
  for (const a of matches) await runAutomation(a, event);
  await autoEnroll(event);
  await db.update(schema.events).set({ processedAt: new Date() }).where(eq(schema.events.id, event.id));
}

/** Re-dispatches events that never finished (e.g. the process restarted mid-flight). */
export async function redispatchStale() {
  const db = await getDb();
  const stale = await db.select().from(schema.events).where(isNull(schema.events.processedAt)).limit(50);
  for (const e of stale) {
    if (Date.now() - e.createdAt.getTime() < 60_000) continue;
    await dispatch(e).catch((err) => console.error("[events] redispatch failed", err));
  }
}
