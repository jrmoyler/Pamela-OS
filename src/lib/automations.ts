import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { AutomationAction, AutomationCondition, RunStep } from "./db/schema";
import type { EventRow } from "./events";
import { emit } from "./events";
import { logActivity, contactName, type Contact } from "./crm";
import { createApproval } from "./approvals";
import { draftInHerVoice } from "./rj/voice";
import { enroll } from "./sequences";

type Automation = typeof schema.automations.$inferSelect;
type Ctx = { event: EventRow; payload: Record<string, unknown>; contact: Contact | null };

export type ActionDef = {
  type: string;
  label: string;
  params: { key: string; label: string; type: "text" | "textarea" | "number" | "select"; options?: string[] }[];
  run: (params: Record<string, unknown>, ctx: Ctx) => Promise<string>;
};

/** Mustache-lite: {{contact.firstName}}, {{payload.summary}} */
export function render(tpl: unknown, ctx: Ctx): string {
  return String(tpl ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const [root, ...rest] = path.split(".");
    let cur: unknown = root === "contact" ? ctx.contact : root === "payload" ? ctx.payload : root === "name" ? contactName(ctx.contact) : undefined;
    if (root === "first_name" || root === "firstName") cur = ctx.contact?.firstName || "friend";
    for (const k of rest) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
    return cur == null ? "" : typeof cur === "object" ? JSON.stringify(cur) : String(cur);
  });
}

export const ACTIONS: ActionDef[] = [
  {
    type: "add_tag",
    label: "Tag the contact",
    params: [{ key: "tag", label: "Tag", type: "text" }],
    async run(p, ctx) {
      if (!ctx.contact) return "skipped: no contact";
      const db = await getDb();
      const tag = render(p.tag, ctx);
      await db.update(schema.contacts).set({ tags: [...new Set([...ctx.contact.tags, tag])] }).where(eq(schema.contacts.id, ctx.contact.id));
      return `tagged ${tag}`;
    },
  },
  {
    type: "create_task",
    label: "Create a task",
    params: [
      { key: "title", label: "Title", type: "text" },
      { key: "dueInDays", label: "Due in (days)", type: "number" },
      { key: "priority", label: "Priority", type: "select", options: ["low", "normal", "high", "urgent"] },
    ],
    async run(p, ctx) {
      const db = await getDb();
      const due = p.dueInDays != null && p.dueInDays !== "" ? new Date(Date.now() + Number(p.dueInDays) * 86_400_000) : null;
      const [t] = await db
        .insert(schema.tasks)
        .values({ title: render(p.title, ctx), dueAt: due, priority: String(p.priority || "normal"), contactId: ctx.contact?.id ?? null, source: "automation" })
        .returning();
      return `task “${t.title}”`;
    },
  },
  {
    type: "create_deal",
    label: "Add to a pipeline",
    params: [
      { key: "pipelineId", label: "Pipeline", type: "text" },
      { key: "title", label: "Deal title", type: "text" },
    ],
    async run(p, ctx) {
      const db = await getDb();
      const pipelineId = String(p.pipelineId);
      const [stage] = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.pipelineId, pipelineId)).orderBy(asc(schema.pipelineStages.position)).limit(1);
      if (!stage) throw new Error("pipeline has no stages");
      const [deal] = await db
        .insert(schema.deals)
        .values({ pipelineId, stageId: stage.id, contactId: ctx.contact?.id ?? null, title: render(p.title || "{{name}}", ctx) })
        .returning();
      await emit("deal.created", { dealId: deal.id, pipelineId, contactId: deal.contactId }, "automation");
      return `deal “${deal.title}” in ${stage.name}`;
    },
  },
  {
    type: "enroll_sequence",
    label: "Enroll in a sequence",
    params: [{ key: "sequenceId", label: "Sequence", type: "text" }],
    async run(p, ctx) {
      if (!ctx.contact) return "skipped: no contact";
      const ok = await enroll(String(p.sequenceId), ctx.contact.id);
      return ok ? "enrolled" : "already enrolled";
    },
  },
  {
    type: "draft_email",
    label: "Draft an email (needs approval)",
    params: [
      { key: "subject", label: "Subject", type: "text" },
      { key: "body", label: "Body", type: "textarea" },
    ],
    async run(p, ctx) {
      if (!ctx.contact?.email) return "skipped: contact has no email";
      const a = await createApproval({
        kind: "email",
        title: `Email to ${contactName(ctx.contact)}: ${render(p.subject, ctx)}`,
        payload: { to: ctx.contact.email, subject: render(p.subject, ctx), body: render(p.body, ctx) },
        contactId: ctx.contact.id,
        createdBy: "automation",
      });
      return `email drafted (${a.id.slice(0, 8)})`;
    },
  },
  {
    type: "draft_sms",
    label: "Draft a text (needs approval)",
    params: [{ key: "body", label: "Message", type: "textarea" }],
    async run(p, ctx) {
      if (!ctx.contact?.phone) return "skipped: contact has no phone";
      const a = await createApproval({
        kind: "sms",
        title: `Text to ${contactName(ctx.contact)}`,
        payload: { to: ctx.contact.phone, body: render(p.body, ctx) },
        contactId: ctx.contact.id,
        createdBy: "automation",
      });
      return `text drafted (${a.id.slice(0, 8)})`;
    },
  },
  {
    type: "rj_draft",
    label: "Have RJ draft a reply in Pamela's voice (needs approval)",
    params: [
      { key: "channel", label: "Channel", type: "select", options: ["email", "sms"] },
      { key: "instructions", label: "What should it say?", type: "textarea" },
    ],
    async run(p, ctx) {
      if (!ctx.contact) return "skipped: no contact";
      const channel = p.channel === "sms" ? "sms" : "email";
      const to = channel === "sms" ? ctx.contact.phone : ctx.contact.email;
      if (!to) return `skipped: contact has no ${channel === "sms" ? "phone" : "email"}`;
      const draft = await draftInHerVoice({ channel, instructions: render(p.instructions, ctx), contact: ctx.contact, context: JSON.stringify(ctx.payload).slice(0, 2000) });
      const a =
        channel === "sms"
          ? await createApproval({ kind: "sms", title: `RJ text to ${contactName(ctx.contact)}`, payload: { to, body: draft.body }, contactId: ctx.contact.id, createdBy: "rj" })
          : await createApproval({ kind: "email", title: `RJ email to ${contactName(ctx.contact)}: ${draft.subject}`, payload: { to, subject: draft.subject, body: draft.body }, contactId: ctx.contact.id, createdBy: "rj" });
      return `RJ drafted ${channel} via ${draft.provider} (${a.id.slice(0, 8)})`;
    },
  },
  {
    type: "log_note",
    label: "Add a note to the timeline",
    params: [{ key: "text", label: "Note", type: "textarea" }],
    async run(p, ctx) {
      await logActivity({ type: "note", contactId: ctx.contact?.id, title: "Automation note", body: render(p.text, ctx) });
      return "noted";
    },
  },
  {
    type: "notify",
    label: "Flag for Pamela (urgent task)",
    params: [{ key: "text", label: "Message", type: "text" }],
    async run(p, ctx) {
      const db = await getDb();
      await db.insert(schema.tasks).values({ title: render(p.text, ctx), priority: "urgent", dueAt: new Date(), contactId: ctx.contact?.id ?? null, source: "automation" });
      return "flagged";
    },
  },
];

export function evalConditions(conds: AutomationCondition[], ctx: Ctx): boolean {
  return conds.every((c) => {
    const [root, ...rest] = c.field.split(".");
    let v: unknown = root === "contact" ? ctx.contact : ctx.payload;
    for (const k of root === "contact" || root === "payload" ? rest : [root, ...rest]) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
    const target = c.value;
    switch (c.op) {
      case "exists":
        return v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
      case "eq":
        return String(v) === String(target);
      case "neq":
        return String(v) !== String(target);
      case "contains":
        return Array.isArray(v) ? v.map(String).includes(String(target)) : String(v ?? "").toLowerCase().includes(String(target).toLowerCase());
      case "gt":
        return Number(v) > Number(target);
      case "lt":
        return Number(v) < Number(target);
    }
  });
}

export async function runAutomation(a: Automation, event: EventRow) {
  const db = await getDb();
  const payload = event.payload ?? {};
  const contactId = typeof payload.contactId === "string" ? payload.contactId : null;
  const contact = contactId ? ((await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)))[0] ?? null) : null;
  const ctx: Ctx = { event, payload, contact };
  const [run] = await db.insert(schema.automationRuns).values({ automationId: a.id, eventId: event.id, name: a.name }).returning();
  const steps: RunStep[] = [];
  let status: "succeeded" | "failed" | "skipped" = "succeeded";
  let error: string | null = null;
  try {
    if (!evalConditions(a.conditions, ctx)) {
      status = "skipped";
      steps.push({ at: new Date().toISOString(), action: "conditions", status: "skipped", detail: "conditions not met" });
    } else {
      for (const action of a.actions as AutomationAction[]) {
        const def = ACTIONS.find((d) => d.type === action.type);
        if (!def) {
          steps.push({ at: new Date().toISOString(), action: action.type, status: "error", detail: "unknown action" });
          throw new Error(`Unknown action ${action.type}`);
        }
        try {
          const detail = await def.run(action.params ?? {}, ctx);
          steps.push({ at: new Date().toISOString(), action: def.label, status: detail.startsWith("skipped") ? "skipped" : "ok", detail });
        } catch (e) {
          steps.push({ at: new Date().toISOString(), action: def.label, status: "error", detail: (e as Error).message });
          throw e;
        }
      }
    }
  } catch (e) {
    status = "failed";
    error = (e as Error).message;
  }
  await db.update(schema.automationRuns).set({ status, steps, error, finishedAt: new Date() }).where(eq(schema.automationRuns.id, run.id));
  await db.update(schema.automations).set({ lastRunAt: new Date() }).where(eq(schema.automations.id, a.id));
  if (status !== "skipped" && contact) {
    await logActivity({ type: "automation", contactId: contact.id, title: `Automation “${a.name}” ${status}`, body: steps.map((s) => `${s.action}: ${s.detail ?? s.status}`).join("\n"), meta: { runId: run.id } });
  }
  return { status, steps, error };
}

/** Manual test run from the Automations page. */
export async function testAutomation(automationId: string, payload: Record<string, unknown>) {
  const db = await getDb();
  const [a] = await db.select().from(schema.automations).where(and(eq(schema.automations.id, automationId)));
  if (!a) throw new Error("Automation not found");
  const [event] = await db.insert(schema.events).values({ type: a.trigger, payload, source: "manual-test", processedAt: new Date() }).returning();
  return runAutomation(a, event);
}
