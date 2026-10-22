import { AsyncLocalStorage } from "node:async_hooks";
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import { getDb, schema } from "./db";

/** How many events deep an automation chain may go (A emits → B emits → …). */
const MAX_DISPATCH_DEPTH = 5;
const dispatchDepth = new AsyncLocalStorage<number>();

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
  { type: "inbox.received", label: "File or note pushed in (Claude, ChatGPT, Meta Muse, Hermes, Drive, Dropbox)", fields: ["inboxItemId", "kind", "source", "fileId", "contactId"] },
  { type: "computer.task_created", label: "Computer task queued for Hermes", fields: ["taskId", "kind", "createdBy", "status"] },
  { type: "computer.task_done", label: "Hermes finished a computer task", fields: ["taskId", "fileIds"] },
  { type: "computer.task_failed", label: "Hermes computer task failed", fields: ["taskId", "error"] },
];

export type EventRow = typeof schema.events.$inferSelect;

export async function emit(type: string, payload: Record<string, unknown> = {}, source = "system"): Promise<EventRow> {
  const db = await getDb();
  const [event] = await db.insert(schema.events).values({ type, payload, source }).returning();
  const depth = dispatchDepth.getStore() ?? 0;
  if (depth >= MAX_DISPATCH_DEPTH) {
    // An automation that re-triggers itself (e.g. "deal.created → add to pipeline")
    // would otherwise recurse forever. Record it as a failed run and stop.
    const msg = `Stopped “${type}”: automations triggered each other more than ${MAX_DISPATCH_DEPTH} levels deep (possible loop).`;
    console.error("[events]", msg);
    await db.insert(schema.automationRuns).values({ eventId: event.id, name: "Event chain stopped", status: "failed", error: msg, finishedAt: new Date() });
    await db.update(schema.events).set({ processedAt: new Date() }).where(eq(schema.events.id, event.id));
    return event;
  }
  try {
    await dispatchDepth.run(depth + 1, () => dispatch(event));
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

/**
 * Re-dispatches events that never finished (e.g. the process restarted mid-flight).
 * Waits well past the longest request (5 min) so an event still being dispatched by
 * its original emit() (slow AI drafting) isn't run a second time in parallel.
 */
const STALE_AFTER_MS = 10 * 60_000;
export async function redispatchStale() {
  const db = await getDb();
  const stale = await db
    .select()
    .from(schema.events)
    .where(and(isNull(schema.events.processedAt), lt(schema.events.createdAt, new Date(Date.now() - STALE_AFTER_MS))))
    .orderBy(asc(schema.events.createdAt))
    .limit(50);
  for (const e of stale) {
    // Claim it first: a second scheduler can't redispatch it concurrently, and an
    // event whose dispatch keeps failing is retried once instead of every tick
    // (each retry would re-run its automations and draft duplicate approvals).
    const [claimed] = await db
      .update(schema.events)
      .set({ processedAt: new Date() })
      .where(and(eq(schema.events.id, e.id), isNull(schema.events.processedAt)))
      .returning({ id: schema.events.id });
    if (!claimed) continue;
    await dispatchDepth.run(1, () => dispatch(e)).catch((err) => console.error("[events] redispatch failed", err));
  }
}
