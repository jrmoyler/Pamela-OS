import { and, asc, desc, eq, gte, ilike, lt, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { ToolDef } from "../ai";
import { contactName, findOrCreateContact, logActivity } from "../crm";
import { createApproval } from "../approvals";
import { emit } from "../events";
import { getSetting } from "../settings";
import { availableSlots, dayBounds, weekBounds, formatSlot, formatInTz } from "../time";
import { collectBriefing, renderBriefingMarkdown } from "./briefing";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
export type RjTool = ToolDef & { run: Handler };

const str = (v: unknown) => (v == null ? "" : String(v));

async function resolveContact(args: Record<string, unknown>) {
  const db = await getDb();
  if (args.contactId) {
    const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, str(args.contactId)));
    if (c) return c;
  }
  const q = str(args.contactName || args.name || args.query);
  if (!q) return null;
  const like = `%${q}%`;
  const [c] = await db
    .select()
    .from(schema.contacts)
    .where(or(ilike(schema.contacts.email, like), sql`(${schema.contacts.firstName} || ' ' || ${schema.contacts.lastName}) ilike ${like}`))
    .limit(1);
  return c ?? null;
}

function parseDue(v: unknown): Date | null {
  const s = str(v).trim().toLowerCase();
  if (!s) return null;
  const now = new Date();
  if (s === "today") return new Date(now.getTime() + 2 * 3600_000);
  if (s === "tomorrow") return new Date(now.getTime() + 86_400_000);
  const inDays = s.match(/^in (\d+) days?$/);
  if (inDays) return new Date(now.getTime() + Number(inDays[1]) * 86_400_000);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export const RJ_TOOLS: RjTool[] = [
  {
    name: "search_contacts",
    description: "Find people in Pamela's CRM by name, email, phone, org, tag or relationship type.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    async run(a) {
      const db = await getDb();
      const like = `%${str(a.query)}%`;
      const rows = await db
        .select()
        .from(schema.contacts)
        .where(
          or(
            ilike(schema.contacts.email, like),
            ilike(schema.contacts.phone, like),
            ilike(schema.contacts.company, like),
            sql`(${schema.contacts.firstName} || ' ' || ${schema.contacts.lastName}) ilike ${like}`,
            sql`${str(a.query)} = any(${schema.contacts.tags})`,
            sql`${str(a.query)} = any(${schema.contacts.relationshipTypes})`,
          ),
        )
        .limit(10);
      return rows.map((c) => ({ id: c.id, name: contactName(c), email: c.email, phone: c.phone, org: c.company, relationship: c.relationshipTypes, tags: c.tags }));
    },
  },
  {
    name: "get_contact",
    description: "Full profile and recent timeline for one person.",
    parameters: { type: "object", properties: { contactId: { type: "string" }, name: { type: "string" } } },
    async run(a) {
      const c = await resolveContact(a);
      if (!c) return { error: "not found" };
      const db = await getDb();
      const acts = await db.select().from(schema.activities).where(eq(schema.activities.contactId, c.id)).orderBy(desc(schema.activities.occurredAt)).limit(15);
      const deals = await db
        .select({ title: schema.deals.title, stage: schema.pipelineStages.name, pipeline: schema.pipelines.name })
        .from(schema.deals)
        .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
        .innerJoin(schema.pipelines, eq(schema.deals.pipelineId, schema.pipelines.id))
        .where(eq(schema.deals.contactId, c.id));
      return {
        id: c.id,
        name: contactName(c),
        email: c.email,
        phone: c.phone,
        org: c.company,
        relationship: c.relationshipTypes,
        tags: c.tags,
        notes: c.notes,
        doNotContact: c.doNotContact,
        deals,
        recent: acts.map((x) => ({ type: x.type, title: x.title, body: x.body?.slice(0, 300), at: x.occurredAt.toISOString() })),
      };
    },
  },
  {
    name: "create_contact",
    description: "Add a person to the CRM (deduplicates by email/phone).",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, org: { type: "string" }, relationship: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
      required: ["name"],
    },
    async run(a) {
      const { contact, created } = await findOrCreateContact({
        name: str(a.name),
        email: str(a.email) || null,
        phone: str(a.phone) || null,
        company: str(a.org) || null,
        source: "rj",
        tags: (a.tags as string[]) ?? [],
        relationshipTypes: a.relationship ? [str(a.relationship)] : [],
      });
      if (created) await emit("contact.created", { contactId: contact.id, source: "rj" }, "rj");
      return { id: contact.id, created };
    },
  },
  {
    name: "add_note",
    description: "Add a note to a person's timeline.",
    parameters: { type: "object", properties: { contactId: { type: "string" }, name: { type: "string" }, text: { type: "string" } }, required: ["text"] },
    async run(a) {
      const c = await resolveContact(a);
      if (!c) return { error: "contact not found" };
      await logActivity({ type: "note", contactId: c.id, title: "Note from RJ", body: str(a.text) });
      return { ok: true };
    },
  },
  {
    name: "create_task",
    description: "Create a task for Pamela. due accepts 'today', 'tomorrow', 'in N days' or an ISO date.",
    parameters: {
      type: "object",
      properties: { title: { type: "string" }, due: { type: "string" }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }, contactId: { type: "string" }, contactName: { type: "string" } },
      required: ["title"],
    },
    async run(a) {
      const db = await getDb();
      const c = a.contactId || a.contactName ? await resolveContact(a) : null;
      const [t] = await db
        .insert(schema.tasks)
        .values({ title: str(a.title), dueAt: parseDue(a.due), priority: str(a.priority) || "normal", contactId: c?.id ?? null, source: "rj" })
        .returning();
      await emit("task.created", { taskId: t.id, contactId: t.contactId, source: "rj" }, "rj");
      return { id: t.id, title: t.title, due: t.dueAt?.toISOString() ?? null };
    },
  },
  {
    name: "list_tasks",
    description: "List open tasks: scope is 'today', 'week', 'overdue' or 'all'.",
    parameters: { type: "object", properties: { scope: { type: "string", enum: ["today", "week", "overdue", "all"] } } },
    async run(a) {
      const db = await getDb();
      const tz = await getSetting("timezone");
      const now = new Date();
      const scope = str(a.scope) || "week";
      const b = scope === "today" ? dayBounds(now, tz) : weekBounds(now, tz);
      const conds = [ne(schema.tasks.status, "done")];
      if (scope === "today" || scope === "week") conds.push(gte(schema.tasks.dueAt, scope === "today" ? new Date(0) : b.start), lt(schema.tasks.dueAt, b.end));
      if (scope === "overdue") conds.push(lt(schema.tasks.dueAt, dayBounds(now, tz).start));
      const rows = await db.select().from(schema.tasks).where(and(...conds)).orderBy(asc(schema.tasks.dueAt)).limit(50);
      return rows.map((t) => ({ id: t.id, title: t.title, priority: t.priority, due: t.dueAt ? formatInTz(t.dueAt, tz, { weekday: "short", month: "short", day: "numeric" }) : null }));
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done.",
    parameters: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
    async run(a) {
      const db = await getDb();
      const [t] = await db.update(schema.tasks).set({ status: "done", completedAt: new Date() }).where(eq(schema.tasks.id, str(a.taskId))).returning();
      if (t) await emit("task.completed", { taskId: t.id, contactId: t.contactId }, "rj");
      return { ok: !!t };
    },
  },
  {
    name: "draft_email",
    description: "Draft an email in Pamela's voice. It is NOT sent — it goes to her Approvals queue.",
    parameters: {
      type: "object",
      properties: { contactId: { type: "string" }, contactName: { type: "string" }, to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
      required: ["subject", "body"],
    },
    async run(a) {
      const c = a.contactId || a.contactName ? await resolveContact(a) : null;
      const to = str(a.to) || c?.email;
      if (!to) return { error: "no email address" };
      const ap = await createApproval({ kind: "email", title: `Email to ${c ? contactName(c) : to}: ${str(a.subject)}`, payload: { to, subject: str(a.subject), body: str(a.body) }, contactId: c?.id, createdBy: "rj" });
      return { approvalId: ap.id, status: "waiting for Pamela's approval", brandIssues: ap.brandIssues };
    },
  },
  {
    name: "draft_text",
    description: "Draft a text message. It is NOT sent — it goes to her Approvals queue.",
    parameters: { type: "object", properties: { contactId: { type: "string" }, contactName: { type: "string" }, to: { type: "string" }, body: { type: "string" } }, required: ["body"] },
    async run(a) {
      const c = a.contactId || a.contactName ? await resolveContact(a) : null;
      const to = str(a.to) || c?.phone;
      if (!to) return { error: "no phone number" };
      const ap = await createApproval({ kind: "sms", title: `Text to ${c ? contactName(c) : to}`, payload: { to, body: str(a.body) }, contactId: c?.id, createdBy: "rj" });
      return { approvalId: ap.id, status: "waiting for Pamela's approval", brandIssues: ap.brandIssues };
    },
  },
  {
    name: "get_calendar",
    description: "Bookings in the next N days (default 7).",
    parameters: { type: "object", properties: { days: { type: "number" } } },
    async run(a) {
      const db = await getDb();
      const tz = await getSetting("timezone");
      const end = new Date(Date.now() + (Number(a.days) || 7) * 86_400_000);
      const rows = await db
        .select({ b: schema.bookings, c: schema.contacts })
        .from(schema.bookings)
        .leftJoin(schema.contacts, eq(schema.bookings.contactId, schema.contacts.id))
        .where(and(gte(schema.bookings.startsAt, new Date()), lt(schema.bookings.startsAt, end), ne(schema.bookings.status, "cancelled")))
        .orderBy(asc(schema.bookings.startsAt));
      return rows.map(({ b, c }) => ({ title: b.title, when: formatSlot(b.startsAt, tz), with: c ? contactName(c) : null, status: b.status }));
    },
  },
  {
    name: "find_open_slots",
    description: "Open booking slots (blackout 3:00–5:30 PM weekdays excluded). Optional booking type slug.",
    parameters: { type: "object", properties: { bookingType: { type: "string" }, days: { type: "number" } } },
    async run(a) {
      const db = await getDb();
      const tz = await getSetting("timezone");
      const blackouts = await getSetting("blackouts");
      const types = await db.select().from(schema.bookingTypes).where(eq(schema.bookingTypes.active, true));
      const type = types.find((t) => t.slug === str(a.bookingType)) ?? types[0];
      if (!type) return { error: "no booking types configured" };
      const busy = await db.select({ startsAt: schema.bookings.startsAt, endsAt: schema.bookings.endsAt }).from(schema.bookings).where(and(gte(schema.bookings.endsAt, new Date()), ne(schema.bookings.status, "cancelled")));
      const slots = availableSlots({ hours: type.hours, durationMin: type.durationMin, bufferMin: type.bufferMin, from: new Date(), days: Number(a.days) || 7, busy, blackouts, tz });
      return { bookingType: type.name, link: `/book/${type.slug}`, slots: slots.slice(0, 8).map((s) => formatSlot(s, tz)) };
    },
  },
  {
    name: "pipeline_summary",
    description: "Deals by stage for each pipeline (or one pipeline by name).",
    parameters: { type: "object", properties: { pipeline: { type: "string" } } },
    async run(a) {
      const db = await getDb();
      const rows = await db
        .select({ pipeline: schema.pipelines.name, stage: schema.pipelineStages.name, deal: schema.deals.title, dealId: schema.deals.id, value: schema.deals.valueCents })
        .from(schema.deals)
        .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
        .innerJoin(schema.pipelines, eq(schema.deals.pipelineId, schema.pipelines.id))
        .where(a.pipeline ? ilike(schema.pipelines.name, `%${str(a.pipeline)}%`) : undefined);
      return rows;
    },
  },
  {
    name: "move_deal",
    description: "Move a deal to a stage (by stage name) in its pipeline.",
    parameters: { type: "object", properties: { dealId: { type: "string" }, stage: { type: "string" } }, required: ["dealId", "stage"] },
    async run(a) {
      const db = await getDb();
      const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, str(a.dealId)));
      if (!deal) return { error: "deal not found" };
      const [stage] = await db
        .select()
        .from(schema.pipelineStages)
        .where(and(eq(schema.pipelineStages.pipelineId, deal.pipelineId), ilike(schema.pipelineStages.name, `%${str(a.stage)}%`)));
      if (!stage) return { error: "stage not found" };
      await db
        .update(schema.deals)
        .set({ stageId: stage.id, status: stage.isWon ? "won" : stage.isLost ? "lost" : "open", updatedAt: new Date() })
        .where(eq(schema.deals.id, deal.id));
      await logActivity({ type: "system", contactId: deal.contactId, dealId: deal.id, title: `Moved to ${stage.name} (by RJ)` });
      await emit("deal.stage_changed", { dealId: deal.id, pipelineId: deal.pipelineId, stageName: stage.name, contactId: deal.contactId }, "rj");
      return { ok: true, stage: stage.name };
    },
  },
  {
    name: "pending_approvals",
    description: "What is waiting in Pamela's Approvals queue.",
    parameters: { type: "object", properties: {} },
    async run() {
      const db = await getDb();
      const rows = await db.select().from(schema.approvals).where(eq(schema.approvals.status, "pending")).orderBy(desc(schema.approvals.createdAt)).limit(25);
      return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, from: r.createdBy, brandIssues: r.brandIssues }));
    },
  },
  {
    name: "daily_triage",
    description: "Today's facts: calendar, due/overdue tasks, approvals, new leads, receptionist calls, failed automations.",
    parameters: { type: "object", properties: {} },
    async run() {
      return renderBriefingMarkdown(await collectBriefing());
    },
  },
  {
    name: "search_history",
    description: "Search everything that has happened (calls, texts, emails, meeting notes, transcripts) for a phrase.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    async run(a) {
      const db = await getDb();
      const like = `%${str(a.query)}%`;
      const acts = await db
        .select({ a: schema.activities, c: schema.contacts })
        .from(schema.activities)
        .leftJoin(schema.contacts, eq(schema.activities.contactId, schema.contacts.id))
        .where(or(ilike(schema.activities.title, like), ilike(schema.activities.body, like)))
        .orderBy(desc(schema.activities.occurredAt))
        .limit(10);
      const meetings = await db
        .select()
        .from(schema.meetings)
        .where(or(ilike(schema.meetings.transcript, like), ilike(schema.meetings.summary, like), ilike(schema.meetings.title, like)))
        .limit(5);
      return {
        activities: acts.map(({ a: x, c }) => ({ type: x.type, title: x.title, who: c ? contactName(c) : null, at: x.occurredAt.toISOString(), excerpt: x.body?.slice(0, 240) })),
        meetings: meetings.map((m) => ({ id: m.id, title: m.title, summary: m.summary?.slice(0, 400) })),
      };
    },
  },
];

export async function runTool(name: string, args: Record<string, unknown>) {
  const tool = RJ_TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `unknown tool ${name}` };
  try {
    return await tool.run(args);
  } catch (e) {
    return { error: (e as Error).message };
  }
}
