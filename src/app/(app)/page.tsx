import Link from "next/link";
import { and, asc, count, desc, eq, gte, lt, ne } from "drizzle-orm";
import { RefreshCw, Bot, Phone, AlertTriangle, CalendarDays } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { dayBounds, weekBounds, localDateKey, formatInTz, isInBlackout } from "@/lib/time";
import { contactName } from "@/lib/crm";
import { requireSession } from "@/lib/auth";
import { Card, CardHeader, Stat, Badge, Button, Input } from "@/components/ui";
import { TaskCheck } from "@/components/work/TaskCheck";
import { fmtDate, miniMarkdown, timeAgo } from "@/lib/utils";
import { toggleTask, createTask } from "./work/actions";
import { refreshBriefing } from "./rj/actions";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const session = await requireSession();
  const db = await getDb();
  const tz = await getSetting("timezone");
  const blackouts = await getSetting("blackouts");
  const now = new Date();
  const today = dayBounds(now, tz);
  const week = weekBounds(now, tz);
  const since7 = new Date(now.getTime() - 7 * 86_400_000);

  const [[briefing], [{ value: pending }], dueWeek, bookings, calls, [{ value: leads7 }], [{ value: openDeals }], failedRuns, recent] = await Promise.all([
    db.select().from(schema.briefings).where(eq(schema.briefings.date, localDateKey(now, tz))),
    db.select({ value: count() }).from(schema.approvals).where(eq(schema.approvals.status, "pending")),
    db
      .select({ t: schema.tasks, c: schema.contacts })
      .from(schema.tasks)
      .leftJoin(schema.contacts, eq(schema.tasks.contactId, schema.contacts.id))
      .where(and(ne(schema.tasks.status, "done"), lt(schema.tasks.dueAt, week.end)))
      .orderBy(asc(schema.tasks.dueAt))
      .limit(25),
    db
      .select({ b: schema.bookings, c: schema.contacts })
      .from(schema.bookings)
      .leftJoin(schema.contacts, eq(schema.bookings.contactId, schema.contacts.id))
      .where(and(gte(schema.bookings.startsAt, today.start), lt(schema.bookings.startsAt, new Date(today.start.getTime() + 3 * 86_400_000)), ne(schema.bookings.status, "cancelled")))
      .orderBy(asc(schema.bookings.startsAt)),
    db.select().from(schema.calls).orderBy(desc(schema.calls.startedAt)).limit(5),
    db.select({ value: count() }).from(schema.contacts).where(gte(schema.contacts.createdAt, since7)),
    db.select({ value: count() }).from(schema.deals).where(eq(schema.deals.status, "open")),
    db.select().from(schema.automationRuns).where(and(eq(schema.automationRuns.status, "failed"), gte(schema.automationRuns.startedAt, since7))).orderBy(desc(schema.automationRuns.startedAt)).limit(3),
    db
      .select({ a: schema.activities, c: schema.contacts })
      .from(schema.activities)
      .leftJoin(schema.contacts, eq(schema.activities.contactId, schema.contacts.id))
      .orderBy(desc(schema.activities.occurredAt))
      .limit(8),
  ]);
  const overdue = dueWeek.filter((x) => x.t.dueAt && x.t.dueAt < today.start).length;
  const protectedNow = isInBlackout(now, blackouts, tz);
  const greeting = formatInTz(now, tz, { hour: "numeric", hourCycle: "h23" });
  const hour = Number(greeting);
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-serif text-sm text-brand">A Cup of Compassion</p>
          <h1 className="text-3xl font-bold tracking-tight">
            {hello}, {session.name.split(" ")[0]}.
          </h1>
          <p className="text-sm text-zinc-500">{formatInTz(now, tz, { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        {protectedNow && <Badge tone="brand" className="px-3 py-1 text-sm">🕊️ {protectedNow.label} — calls go to messages</Badge>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting for your yes" value={Number(pending)} href="/approvals" hint="drafts & sends" />
        <Stat label="Due this week" value={dueWeek.length} href="/work" hint={overdue ? `${overdue} overdue` : "on track"} />
        <Stat label="New people (7 days)" value={Number(leads7)} href="/contacts" />
        <Stat label="Open deals" value={Number(openDeals)} href="/pipelines" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-brand" /> Morning read from RJ
                </span>
              }
              subtitle={briefing ? `Prepared ${timeAgo(briefing.createdAt)} · ${briefing.provider}` : "Builds automatically after 6 AM"}
              action={
                <form action={refreshBriefing}>
                  <Button size="sm" variant="ghost" title="Rebuild" aria-label="Rebuild morning read"><RefreshCw className="h-4 w-4" /></Button>
                </form>
              }
            />
            <div className="md px-4 py-3 text-sm" dangerouslySetInnerHTML={{ __html: miniMarkdown(briefing?.content ?? "Tap refresh to build today's read.") }} />
            <div className="border-t border-zinc-100 px-4 py-2">
              <Link href="/rj" className="text-sm font-medium text-brand hover:underline">Talk to RJ →</Link>
            </div>
          </Card>

          <Card>
            <CardHeader title="Due this week" action={<Link href="/work" className="text-sm text-brand hover:underline">All work</Link>} />
            <form action={createTask} className="flex flex-wrap gap-2 border-b border-zinc-100 px-4 py-3">
              <Input name="title" aria-label="New task" placeholder="Quick add a task…" required className="min-w-40 flex-1" />
              <Input name="due" type="date" aria-label="Due date" className="w-40" defaultValue={localDateKey(now, tz)} />
              <Button size="md">Add</Button>
            </form>
            <ul className="divide-y divide-zinc-100">
              {dueWeek.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">Nothing due this week.</li>}
              {dueWeek.map(({ t, c }) => {
                const late = t.dueAt && t.dueAt < today.start;
                return (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                    <TaskCheck done={false} label={t.title} onToggle={toggleTask.bind(null, t.id)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <p className={late ? "text-xs text-red-600" : "text-xs text-zinc-500"}>
                        {t.dueAt && fmtDate(t.dueAt, tz, { weekday: "short", month: "short", day: "numeric" })}
                        {c && ` · ${contactName(c)}`}
                      </p>
                    </div>
                    {t.priority === "urgent" && <Badge tone="red">urgent</Badge>}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Recent activity" />
            <ul className="divide-y divide-zinc-100">
              {recent.map(({ a, c }) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <Badge>{a.type}</Badge>
                  <span className="flex-1 truncate">
                    {a.title}
                    {c && (
                      <Link href={`/contacts/${c.id}`} className="ml-1 text-brand hover:underline">
                        · {contactName(c)}
                      </Link>
                    )}
                  </span>
                  <span className="text-xs text-zinc-400">{timeAgo(a.occurredAt)}</span>
                </li>
              ))}
              {recent.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">Quiet so far.</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          {failedRuns.length > 0 && (
            <Card className="border-red-200">
              <CardHeader title={<span className="flex items-center gap-2 text-red-700"><AlertTriangle className="h-4 w-4" /> Needs attention</span>} />
              <ul className="divide-y divide-zinc-100 text-sm">
                {failedRuns.map((r) => (
                  <li key={r.id} className="px-4 py-2">
                    <Link href="/automations?tab=runs" className="font-medium hover:text-brand">{r.name}</Link>
                    <p className="text-xs text-red-600">{r.error}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-brand" /> Next 3 days</span>} action={<Link href="/booking" className="text-sm text-brand hover:underline">Booking</Link>} />
            <ul className="divide-y divide-zinc-100 text-sm">
              {bookings.length === 0 && <li className="px-4 py-4 text-zinc-500">No appointments.</li>}
              {bookings.map(({ b, c }) => (
                <li key={b.id} className="px-4 py-2.5">
                  <p className="font-medium">{fmtDate(b.startsAt, tz, { weekday: "short", hour: "numeric", minute: "2-digit" })} · {b.title}</p>
                  {c && <p className="text-xs text-zinc-500">{contactName(c)} · via {b.source}</p>}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Phone className="h-4 w-4 text-brand" /> Receptionist</span>} action={<Link href="/receptionist" className="text-sm text-brand hover:underline">Calls</Link>} />
            <ul className="divide-y divide-zinc-100 text-sm">
              {calls.length === 0 && <li className="px-4 py-4 text-zinc-500">No calls yet. (323) 943-ACUP is answered 24/7.</li>}
              {calls.map((call) => (
                <li key={call.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{call.fromNumber ?? "Unknown"}</span>
                    {call.urgency === "urgent" && <Badge tone="red">urgent</Badge>}
                    {call.disposition && <Badge>{call.disposition}</Badge>}
                    <span className="ml-auto text-xs text-zinc-400">{timeAgo(call.startedAt)}</span>
                  </div>
                  {call.summary && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{call.summary}</p>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
