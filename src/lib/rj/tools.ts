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
  // A bare YYYY-MM-DD parses as UTC midnight, which is the previous evening in US time zones; anchor it to midday.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s);
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
  {
    name: "search_files",
    description: "Search Pamela's Library: every file uploaded, made in a studio, pulled from Drive/Dropbox or pushed in by Claude, ChatGPT, Meta Muse or Hermes.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words in the file name, description or tags. Leave empty for the newest files." },
        kind: { type: "string", enum: ["audio", "video", "image", "document", "other"] },
        source: { type: "string", description: "upload, link, gdrive, dropbox, claude, chatgpt, meta or hermes" },
      },
    },
    async run(a) {
      const db = await getDb();
      const q = str(a.query).trim();
      const like = `%${q}%`;
      const rows = await db
        .select()
        .from(schema.files)
        .where(
          and(
            q ? or(ilike(schema.files.name, like), ilike(schema.files.description, like), sql`${q} = any(${schema.files.tags})`) : undefined,
            a.kind ? eq(schema.files.kind, str(a.kind)) : undefined,
            a.source ? eq(schema.files.source, str(a.source)) : undefined,
          ),
        )
        .orderBy(desc(schema.files.createdAt))
        .limit(20);
      return rows.map((f) => ({ id: f.id, name: f.name, kind: f.kind, mime: f.mime, size: f.size, source: f.source, description: f.description, tags: f.tags, added: f.createdAt.toISOString() }));
    },
  },
  {
    name: "read_file_text",
    description: "Read the text of a file in the Library (txt, md, csv, json, html, or a Word .docx). Returns the first 20,000 characters.",
    parameters: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"] },
    async run(a) {
      const { readFile, isTextFile, isDocx } = await import("../storage");
      const f = /^[0-9a-f-]{36}$/i.test(str(a.fileId)) ? await readFile(str(a.fileId)) : null;
      if (!f) return { error: "not found" };
      if (isDocx(f.mime, f.name)) {
        const { docxParagraphs, docxToMarkdown } = await import("../docx");
        const paras = docxParagraphs(f.data);
        if (paras) return { name: f.name, mime: f.mime, text: docxToMarkdown(paras).slice(0, 20_000), note: "Word document shown as text; it can't be rewritten in place." };
      }
      if (!isTextFile(f.mime, f.name)) return { error: `“${f.name}” is ${f.mime}; only text files can be read here.`, name: f.name, mime: f.mime };
      return { name: f.name, mime: f.mime, text: f.data.toString("utf8").slice(0, 20_000) };
    },
  },
  {
    name: "update_file",
    description:
      "Edit a file in Pamela's Library: replace a text file's contents (txt, md, csv, json, html) and/or change its name, description or tags. Read it first with read_file_text so you don't lose what's there.",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        text: { type: "string", description: "The complete new contents (text files only)" },
        name: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["fileId"],
    },
    async run(a) {
      const { getFileRecord, isTextFile, replaceFileContent } = await import("../storage");
      const id = str(a.fileId);
      const rec = /^[0-9a-f-]{36}$/i.test(id) ? await getFileRecord(id) : null;
      if (!rec) return { error: "not found" };
      if (a.text != null) {
        if (!isTextFile(rec.mime, rec.name)) return { error: `“${rec.name}” is ${rec.mime}; only text files can be rewritten. Push a new file instead.` };
        await replaceFileContent(id, Buffer.from(str(a.text), "utf8"));
      }
      const set: Partial<typeof schema.files.$inferInsert> = {};
      if (str(a.name).trim()) set.name = str(a.name).trim();
      if (a.description != null) set.description = str(a.description).trim() || null;
      if (Array.isArray(a.tags)) set.tags = a.tags.map(String).slice(0, 20);
      const db = await getDb();
      if (Object.keys(set).length) await db.update(schema.files).set(set).where(eq(schema.files.id, id));
      const [f] = await db.select().from(schema.files).where(eq(schema.files.id, id));
      return { ok: true, fileId: f.id, name: f.name, size: f.size, description: f.description, tags: f.tags };
    },
  },
  {
    name: "list_pipelines",
    description: "Every pipeline with its stages (ids and names) and how many open deals each stage has.",
    parameters: { type: "object", properties: {} },
    async run() {
      const db = await getDb();
      const [pipes, stages, counts] = await Promise.all([
        db.select().from(schema.pipelines).orderBy(asc(schema.pipelines.position), asc(schema.pipelines.createdAt)),
        db.select().from(schema.pipelineStages).orderBy(asc(schema.pipelineStages.position)),
        db.select({ stageId: schema.deals.stageId, n: sql<number>`count(*)::int` }).from(schema.deals).groupBy(schema.deals.stageId),
      ]);
      const n = new Map(counts.map((c) => [c.stageId, c.n]));
      return pipes.map((p) => ({
        id: p.id,
        name: p.name,
        businessLine: p.businessLine,
        stages: stages.filter((st) => st.pipelineId === p.id).map((st) => ({ id: st.id, name: st.name, won: st.isWon, lost: st.isLost, deals: n.get(st.id) ?? 0 })),
      }));
    },
  },
  {
    name: "create_pipeline",
    description: "Create a new sales/relationship pipeline (e.g. “DR investor pitch”, “Church bundle prospects”) with its stages in order. Stages named Won/Booked/Paid count as won; Lost/Passed as lost.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        businessLine: { type: "string", description: "Which part of the business it belongs to (defaults to the name)" },
        stages: { type: "array", items: { type: "string" }, description: "Stage names in order. Default: New, In progress, Won, Lost" },
      },
      required: ["name"],
    },
    async run(a) {
      const { createPipeline, findPipeline } = await import("../modules/pipelines");
      const existing = await findPipeline(str(a.name));
      if (existing && existing.name.toLowerCase() === str(a.name).trim().toLowerCase()) return { error: `A pipeline called “${existing.name}” already exists.`, pipelineId: existing.id };
      const { pipeline, stages } = await createPipeline({ name: str(a.name), businessLine: str(a.businessLine) || null, stages: Array.isArray(a.stages) ? a.stages.map(String) : undefined });
      return { ok: true, pipelineId: pipeline.id, name: pipeline.name, stages: stages.map((st) => ({ id: st.id, name: st.name })), link: `/pipelines/${pipeline.id}` };
    },
  },
  {
    name: "add_pipeline_stage",
    description: "Add a stage to the end of an existing pipeline.",
    parameters: { type: "object", properties: { pipeline: { type: "string", description: "Pipeline id or name" }, stage: { type: "string" } }, required: ["pipeline", "stage"] },
    async run(a) {
      const { addStage, findPipeline } = await import("../modules/pipelines");
      const p = await findPipeline(str(a.pipeline));
      if (!p) return { error: "pipeline not found" };
      if (!str(a.stage).trim()) return { error: "stage is required" };
      const st = await addStage(p.id, str(a.stage));
      return { ok: true, pipelineId: p.id, stageId: st.id, stage: st.name };
    },
  },
  {
    name: "create_deal",
    description: "Add a deal (a prospect, opportunity, booking or donation in progress) to a pipeline. Names a contact by id, or by name/email (created if new).",
    parameters: {
      type: "object",
      properties: {
        pipeline: { type: "string", description: "Pipeline id or name" },
        title: { type: "string" },
        stage: { type: "string", description: "Stage id or name (default: the first stage)" },
        value: { type: "number", description: "Dollar value" },
        contactId: { type: "string" },
        contactName: { type: "string" },
        contactEmail: { type: "string" },
        notes: { type: "string" },
        due: { type: "string", description: "YYYY-MM-DD, 'tomorrow' or 'in 3 days'" },
      },
      required: ["pipeline", "title"],
    },
    async run(a) {
      const { createDeal, findPipeline, findStage } = await import("../modules/pipelines");
      const p = await findPipeline(str(a.pipeline));
      if (!p) return { error: "pipeline not found — create it with create_pipeline first" };
      const st = await findStage(p.id, str(a.stage) || null);
      if (!st) return { error: a.stage ? `No stage like “${str(a.stage)}” in ${p.name}.` : `${p.name} has no stages yet.` };
      const { deal } = await createDeal({
        pipelineId: p.id,
        stageId: st.id,
        title: str(a.title),
        valueCents: Number(a.value || 0) * 100,
        contactId: /^[0-9a-f-]{36}$/i.test(str(a.contactId)) ? str(a.contactId) : null,
        contactName: str(a.contactName) || null,
        contactEmail: str(a.contactEmail) || null,
        notes: str(a.notes) || null,
        dueDate: parseDue(a.due),
        by: str(a.by) || "rj",
      });
      return { ok: true, dealId: deal.id, title: deal.title, pipeline: p.name, stage: st.name, contactId: deal.contactId, link: `/pipelines/${p.id}` };
    },
  },
  {
    name: "update_deal",
    description: "Change a deal's title, value, notes or due date.",
    parameters: {
      type: "object",
      properties: { dealId: { type: "string" }, title: { type: "string" }, value: { type: "number" }, notes: { type: "string" }, due: { type: "string" } },
      required: ["dealId"],
    },
    async run(a) {
      const db = await getDb();
      const set: Partial<typeof schema.deals.$inferInsert> = { updatedAt: new Date() };
      if (str(a.title).trim()) set.title = str(a.title).trim();
      if (a.value != null) set.valueCents = Math.max(0, Math.round(Number(a.value) * 100));
      if (a.notes != null) set.notes = str(a.notes) || null;
      if (a.due != null) set.dueDate = parseDue(a.due);
      const [deal] = /^[0-9a-f-]{36}$/i.test(str(a.dealId)) ? await db.update(schema.deals).set(set).where(eq(schema.deals.id, str(a.dealId))).returning() : [];
      if (!deal) return { error: "deal not found" };
      return { ok: true, dealId: deal.id, title: deal.title, value: deal.valueCents / 100 };
    },
  },
  {
    name: "list_funnels",
    description: "Pamela's funnel pages and signup forms, with where each form sends people.",
    parameters: { type: "object", properties: {} },
    async run() {
      const db = await getDb();
      const [pages, forms] = await Promise.all([
        db.select().from(schema.pages).orderBy(desc(schema.pages.updatedAt)).limit(50),
        db.select().from(schema.forms).orderBy(desc(schema.forms.createdAt)).limit(50),
      ]);
      return {
        pages: pages.map((p) => ({ id: p.id, title: p.title, slug: p.slug, kind: p.kind, published: p.published, views: p.views, blocks: p.blocks.map((b) => b.type) })),
        forms: forms.map((f) => ({ id: f.id, name: f.name, submissions: f.submissions, pipelineId: f.pipelineId, stageId: f.stageId, tags: f.tags })),
      };
    },
  },
  {
    name: "create_funnel",
    description:
      "Build a funnel: a landing page (draft) and, when it has a form block, a signup form that files each person as a deal in a pipeline stage. Give a template, or write the page yourself as blocks. Block types: hero {headline, subheadline, buttonText, buttonHref}, text {heading, body}, form {heading, buttonText}, booking {slug, heading, text}, cta {headline, text, buttonText, buttonHref}, testimonial {quote, author, role}, product {name, description, priceCents, buttonText}, contact {text}. Going live waits for Pamela's approval.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        template: { type: "string", enum: ["lead", "speaking", "sales", "blank", "thanks"], description: "Starting layout when you don't send blocks (default lead)" },
        slug: { type: "string", description: "Web address after /p/ (made from the title if empty)" },
        blocks: { type: "array", items: { type: "object", properties: { type: { type: "string" }, props: { type: "object" } }, required: ["type"] } },
        pipeline: { type: "string", description: "Pipeline id or name signups go into" },
        stage: { type: "string", description: "Stage in that pipeline (default: first stage)" },
        tags: { type: "array", items: { type: "string" }, description: "Tags put on everyone who signs up" },
        requestPublish: { type: "boolean", description: "Also put “publish this page” in Pamela's Approvals" },
      },
      required: ["title"],
    },
    async run(a) {
      const { createFunnel } = await import("../modules/funnels");
      const { findPipeline, findStage } = await import("../modules/pipelines");
      let pipelineId: string | null = null;
      let stageId: string | null = null;
      if (str(a.pipeline)) {
        const p = await findPipeline(str(a.pipeline));
        if (!p) return { error: "pipeline not found — create it with create_pipeline first" };
        const st = await findStage(p.id, str(a.stage) || null);
        if (!st) return { error: `No matching stage in ${p.name}.` };
        pipelineId = p.id;
        stageId = st.id;
      }
      const blocks = Array.isArray(a.blocks) ? (a.blocks as { type: string; props?: Record<string, unknown> }[]).filter((b) => b && typeof b.type === "string") : undefined;
      const { page, form } = await createFunnel({
        title: str(a.title),
        template: str(a.template) || undefined,
        slug: str(a.slug) || undefined,
        blocks,
        pipelineId,
        stageId,
        formTags: Array.isArray(a.tags) ? a.tags.map(String).slice(0, 20) : [],
      });
      if (a.requestPublish) {
        const { appUrl } = await import("../outbound");
        await createApproval({
          kind: "publish_page",
          title: `Publish page “${page.title}”`,
          summary: `Goes live at ${appUrl()}/p/${page.slug} with ${page.blocks.length} block${page.blocks.length === 1 ? "" : "s"}.`,
          payload: { pageId: page.id },
          subjectType: "page",
          subjectId: page.id,
        });
      }
      return {
        ok: true,
        pageId: page.id,
        slug: page.slug,
        formId: form?.id ?? null,
        signupsGoTo: pipelineId ? { pipelineId, stageId } : null,
        status: a.requestPublish ? "draft — publish request waiting in Approvals" : "draft",
        editLink: `/funnels/pages/${page.id}`,
      };
    },
  },
  {
    name: "request_computer_task",
    description:
      "Ask Hermes to do something on Pamela's computer or in her browser (look something up on a site she's logged into, download a document, organise files). It waits in the Command Center for her yes before Hermes starts. Hermes never sends, posts or pays.",
    parameters: {
      type: "object",
      properties: { instruction: { type: "string" }, kind: { type: "string", enum: ["browser", "computer", "files"] } },
      required: ["instruction"],
    },
    async run(a) {
      const { createComputerTask } = await import("../hub/computer");
      const kind = ["browser", "computer", "files"].includes(str(a.kind)) ? (str(a.kind) as "browser") : "browser";
      const t = await createComputerTask(str(a.instruction), kind, "rj");
      return { taskId: t.id, status: t.status, note: "Waiting for Pamela's approval in the Command Center." };
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
