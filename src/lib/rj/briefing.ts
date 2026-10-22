import { and, desc, eq, gte, lt, lte, ne, count } from "drizzle-orm";
import { getDb, schema } from "../db";
import { getSetting } from "../settings";
import { dayBounds, weekBounds, localDateKey, zonedParts, formatInTz } from "../time";
import { contactName } from "../crm";
import { complete } from "../ai";
import { herVoiceSystem } from "./voice";

export type BriefingData = {
  date: string;
  bookings: { title: string; at: string; who: string }[];
  overdue: { id: string; title: string; due: string | null }[];
  dueToday: { id: string; title: string; priority: string }[];
  dueThisWeek: number;
  pendingApprovals: number;
  newLeads: { name: string; source: string | null }[];
  calls: { from: string; disposition: string | null; urgency: string; summary: string | null }[];
  failedRuns: { name: string; error: string | null }[];
  meetingsYesterday: { title: string; actionItems: number }[];
};

export async function collectBriefing(now = new Date()): Promise<BriefingData> {
  const db = await getDb();
  const tz = await getSetting("timezone");
  const today = dayBounds(now, tz);
  const week = weekBounds(now, tz);
  const since = new Date(now.getTime() - 24 * 3600_000);
  const yesterday = { start: new Date(today.start.getTime() - 86_400_000), end: today.start };

  const bookings = await db
    .select({ b: schema.bookings, c: schema.contacts })
    .from(schema.bookings)
    .leftJoin(schema.contacts, eq(schema.bookings.contactId, schema.contacts.id))
    .where(and(gte(schema.bookings.startsAt, today.start), lt(schema.bookings.startsAt, today.end), ne(schema.bookings.status, "cancelled")))
    .orderBy(schema.bookings.startsAt);
  const openTasks = await db.select().from(schema.tasks).where(ne(schema.tasks.status, "done"));
  const [{ value: pending }] = await db.select({ value: count() }).from(schema.approvals).where(eq(schema.approvals.status, "pending"));
  const leads = await db.select().from(schema.contacts).where(gte(schema.contacts.createdAt, since)).orderBy(desc(schema.contacts.createdAt)).limit(20);
  const calls = await db.select().from(schema.calls).where(gte(schema.calls.startedAt, since)).orderBy(desc(schema.calls.startedAt)).limit(20);
  const failed = await db
    .select()
    .from(schema.automationRuns)
    .where(and(eq(schema.automationRuns.status, "failed"), gte(schema.automationRuns.startedAt, since)))
    .limit(20);
  const meetings = await db
    .select()
    .from(schema.meetings)
    .where(and(gte(schema.meetings.startedAt, yesterday.start), lte(schema.meetings.startedAt, yesterday.end)));

  return {
    date: localDateKey(now, tz),
    bookings: bookings.map(({ b, c }) => ({ title: b.title, at: formatInTz(b.startsAt, tz, { hour: "numeric", minute: "2-digit" }), who: c ? contactName(c) : "" })),
    overdue: openTasks
      .filter((t) => t.dueAt && t.dueAt < today.start)
      .map((t) => ({ id: t.id, title: t.title, due: t.dueAt ? formatInTz(t.dueAt, tz, { month: "short", day: "numeric" }) : null })),
    dueToday: openTasks.filter((t) => t.dueAt && t.dueAt >= today.start && t.dueAt < today.end).map((t) => ({ id: t.id, title: t.title, priority: t.priority })),
    dueThisWeek: openTasks.filter((t) => t.dueAt && t.dueAt >= week.start && t.dueAt < week.end).length,
    pendingApprovals: Number(pending),
    newLeads: leads.map((c) => ({ name: contactName(c), source: c.source })),
    calls: calls.map((c) => ({ from: c.fromNumber ?? "unknown", disposition: c.disposition, urgency: c.urgency, summary: c.summary })),
    failedRuns: failed.map((r) => ({ name: r.name, error: r.error })),
    meetingsYesterday: meetings.map((m) => ({ title: m.title, actionItems: m.actionItems.length })),
  };
}

export function renderBriefingMarkdown(d: BriefingData): string {
  const lines: string[] = [];
  const list = <T,>(title: string, items: T[], fmt: (i: T) => string, empty?: string) => {
    if (!items.length && !empty) return;
    lines.push(`### ${title}`);
    lines.push(items.length ? items.map((i) => `- ${fmt(i)}`).join("\n") : `- ${empty}`);
    lines.push("");
  };
  list("On the calendar today", d.bookings, (b) => `${b.at} — ${b.title}${b.who ? ` with ${b.who}` : ""}`, "Nothing booked. Protected time.");
  list("Due today", d.dueToday, (t) => `${t.title}${t.priority === "urgent" || t.priority === "high" ? ` (${t.priority})` : ""}`, "Nothing due today.");
  list("Overdue", d.overdue, (t) => `${t.title}${t.due ? ` — was due ${t.due}` : ""}`);
  lines.push(`### Waiting on you\n- ${d.pendingApprovals} draft${d.pendingApprovals === 1 ? "" : "s"} in Approvals\n- ${d.dueThisWeek} task${d.dueThisWeek === 1 ? "" : "s"} due this week\n`);
  list("New people (last 24h)", d.newLeads, (l) => `${l.name}${l.source ? ` · via ${l.source}` : ""}`);
  list("Receptionist (last 24h)", d.calls, (c) => `${c.urgency === "urgent" ? "🔴 " : ""}${c.from} — ${c.disposition ?? "call"}${c.summary ? `: ${c.summary}` : ""}`);
  list("Meetings yesterday", d.meetingsYesterday, (m) => `${m.title} — ${m.actionItems} action item${m.actionItems === 1 ? "" : "s"}`);
  list("Needs attention: automations that failed", d.failedRuns, (r) => `${r.name}: ${r.error ?? "failed"}`);
  return lines.join("\n").trim();
}

/** Builds (or rebuilds) the morning read for a date. */
export async function buildBriefing(now = new Date()) {
  const db = await getDb();
  const data = await collectBriefing(now);
  const facts = renderBriefingMarkdown(data);
  const ai = await complete({
    task: "summarize",
    maxTokens: 700,
    messages: [
      { role: "system", content: `${await herVoiceSystem()}\n\nYou are RJ, Pamela's operator. Write her morning read: a warm 3–5 sentence opener that names the 2–3 things that matter most today, then stop. Use only the facts given.` },
      { role: "user", content: facts },
    ],
  });
  const opener = ai?.content.trim() || defaultOpener(data);
  const content = `${opener}\n\n${facts}`;
  await db
    .insert(schema.briefings)
    .values({ date: data.date, content, data: data as unknown as Record<string, unknown>, provider: ai?.provider ?? "template" })
    .onConflictDoUpdate({ target: schema.briefings.date, set: { content, data: data as unknown as Record<string, unknown>, provider: ai?.provider ?? "template", createdAt: new Date() } });
  return { content, data };
}

function defaultOpener(d: BriefingData) {
  const parts = [`Good morning, Pamela.`];
  if (d.bookings.length) parts.push(`You have ${d.bookings.length} appointment${d.bookings.length === 1 ? "" : "s"} today, first at ${d.bookings[0].at}.`);
  else parts.push("Your calendar is open today.");
  const urgent = d.calls.filter((c) => c.urgency === "urgent").length;
  if (urgent) parts.push(`${urgent} urgent call${urgent === 1 ? "" : "s"} came in — see the receptionist log.`);
  if (d.pendingApprovals) parts.push(`${d.pendingApprovals} draft${d.pendingApprovals === 1 ? " is" : "s are"} waiting for your yes.`);
  if (d.overdue.length) parts.push(`${d.overdue.length} task${d.overdue.length === 1 ? " is" : "s are"} overdue.`);
  return parts.join(" ");
}

/** Scheduler hook: builds today's briefing once, after 6am local. */
export async function ensureTodaysBriefing(now = new Date()) {
  const tz = await getSetting("timezone");
  if (zonedParts(now, tz).hour < 6) return "too early";
  const db = await getDb();
  const key = localDateKey(now, tz);
  const [existing] = await db.select({ id: schema.briefings.id }).from(schema.briefings).where(eq(schema.briefings.date, key));
  if (existing) return "exists";
  await buildBriefing(now);
  return "built";
}
