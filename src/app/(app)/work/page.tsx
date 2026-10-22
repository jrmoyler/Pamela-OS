import Link from "next/link";
import { and, asc, eq, isNull, lt, ne, count } from "drizzle-orm";
import { LayoutGrid, Plus } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { weekBounds, dayBounds } from "@/lib/time";
import { contactName } from "@/lib/crm";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Select, Tabs, Field } from "@/components/ui";
import { TaskCheck } from "@/components/work/TaskCheck";
import { fmtDate } from "@/lib/utils";
import { createTask, toggleTask, createBoard } from "./actions";

export const metadata = { title: "Work" };

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "week" } = await searchParams;
  const db = await getDb();
  const tz = await getSetting("timezone");
  const now = new Date();
  const week = weekBounds(now, tz);
  const today = dayBounds(now, tz);

  const where =
    view === "week"
      ? and(ne(schema.tasks.status, "done"), lt(schema.tasks.dueAt, week.end))
      : view === "nodate"
        ? and(ne(schema.tasks.status, "done"), isNull(schema.tasks.dueAt))
        : view === "done"
          ? eq(schema.tasks.status, "done")
          : ne(schema.tasks.status, "done");
  const tasks = await db
    .select({ t: schema.tasks, c: schema.contacts })
    .from(schema.tasks)
    .leftJoin(schema.contacts, eq(schema.tasks.contactId, schema.contacts.id))
    .where(where)
    .orderBy(asc(schema.tasks.dueAt))
    .limit(300);
  const boards = await db.select().from(schema.boards).orderBy(asc(schema.boards.position));
  const counts = await db.select({ boardId: schema.boardItems.boardId, n: count() }).from(schema.boardItems).groupBy(schema.boardItems.boardId);
  const [{ value: weekCount }] = await db
    .select({ value: count() })
    .from(schema.tasks)
    .where(and(ne(schema.tasks.status, "done"), lt(schema.tasks.dueAt, week.end)));

  const groups = new Map<string, typeof tasks>();
  for (const row of tasks) {
    const d = row.t.dueAt;
    const key = view !== "week" ? "Tasks" : !d ? "No date" : d < today.start ? "Overdue" : d < today.end ? "Today" : fmtDate(d, tz, { weekday: "long", month: "short", day: "numeric" });
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return (
    <>
      <PageHeader title="Work" subtitle="Everything due, every board, every business line." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs
            active={`/work?view=${view}`}
            tabs={[
              { href: "/work?view=week", label: "Due this week", count: Number(weekCount) },
              { href: "/work?view=all", label: "All open" },
              { href: "/work?view=nodate", label: "No due date" },
              { href: "/work?view=done", label: "Done" },
            ]}
          />
          <Card className="mb-4 p-3">
            <form action={createTask} className="flex flex-wrap gap-2">
              <Input name="title" placeholder="Add a task… (or dictate it)" className="min-w-48 flex-1" required />
              <Input name="due" type="datetime-local" className="w-52" />
              <Select name="priority" className="w-28" defaultValue="normal">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
              <Select name="boardId" className="w-44" defaultValue="">
                <option value="">No board</option>
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
              <Button><Plus className="h-4 w-4" /> Add</Button>
            </form>
          </Card>
          {tasks.length === 0 && <p className="text-sm text-zinc-500">Nothing here. Breathe. ☕</p>}
          {[...groups.entries()].map(([label, rows]) => (
            <Card key={label} className="mb-4">
              <CardHeader title={<span className={label === "Overdue" ? "text-red-600" : undefined}>{label}</span>} />
              <ul className="divide-y divide-zinc-100">
                {rows.map(({ t, c }) => (
                  <li key={t.id} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="pt-0.5"><TaskCheck done={t.status === "done"} label={t.title} onToggle={toggleTask.bind(null, t.id)} /></span>
                    <div className="min-w-0 flex-1">
                      <p className={t.status === "done" ? "text-sm text-zinc-400 line-through" : "text-sm font-medium"}>{t.title}</p>
                      <p className="text-xs text-zinc-500">
                        {t.dueAt && fmtDate(t.dueAt, tz)}
                        {c && (
                          <>
                            {" · "}
                            <Link href={`/contacts/${c.id}`} className="text-brand hover:underline">{contactName(c)}</Link>
                          </>
                        )}
                        {t.source !== "manual" && ` · from ${t.source}`}
                      </p>
                    </div>
                    {(t.priority === "urgent" || t.priority === "high") && <Badge tone={t.priority === "urgent" ? "red" : "amber"}>{t.priority}</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Boards" />
            <ul className="divide-y divide-zinc-100">
              {boards.map((b) => (
                <li key={b.id}>
                  <Link href={`/work/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-brand-soft/50">
                    <LayoutGrid className="h-4 w-4 text-brand" />
                    <span className="flex-1 text-sm font-medium">{b.name}</span>
                    <span className="text-xs text-zinc-500">{counts.find((x) => x.boardId === b.id)?.n ?? 0}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <form action={createBoard} className="space-y-2 border-t border-zinc-100 p-4">
              <Field label="New board"><Input name="name" placeholder="e.g. Spring gala" required /></Field>
              <Input name="businessLine" placeholder="Business line (optional)" />
              <Button variant="outline" size="sm" className="w-full">Create board</Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
