import Link from "next/link";
import { desc, eq, asc } from "drizzle-orm";
import { Workflow, Play, Pencil, Trash2, Plus } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { ACTIONS } from "@/lib/automations";
import { EVENT_CATALOG } from "@/lib/events";
import { contactName } from "@/lib/crm";
import { PageHeader, Card, Badge, Button, Tabs, EmptyState, Select, Input, statusTone } from "@/components/ui";
import { AutomationBuilder } from "@/components/automations/Builder";
import { fmtDate, timeAgo } from "@/lib/utils";
import { saveAutomation, toggleAutomation, deleteAutomation, runTest, retryJob } from "./actions";

export const metadata = { title: "Automations" };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string; status?: string }> }) {
  const { tab = "automations", edit, status } = await searchParams;
  const db = await getDb();
  const tz = await getSetting("timezone");
  const automations = await db.select().from(schema.automations).orderBy(asc(schema.automations.createdAt));
  const runs = await db.select().from(schema.automationRuns).orderBy(desc(schema.automationRuns.startedAt)).limit(150);
  const failed = runs.filter((r) => r.status === "failed").length;
  const jobs = await db.select().from(schema.jobs).orderBy(desc(schema.jobs.createdAt)).limit(100);
  const pipelines = await db.select({ id: schema.pipelines.id, name: schema.pipelines.name }).from(schema.pipelines);
  const sequences = await db.select({ id: schema.sequences.id, name: schema.sequences.name }).from(schema.sequences);
  const contacts = await db.select().from(schema.contacts).orderBy(desc(schema.contacts.createdAt)).limit(100);
  const actionMeta = ACTIONS.map(({ type, label, params }) => ({ type, label, params }));
  const editing = edit && edit !== "new" ? automations.find((a) => a.id === edit) : undefined;

  return (
    <>
      <PageHeader
        title="Automations"
        subtitle="The glue: events from every module trigger automations and sequences. Every run is logged, and failures surface here and on Today."
        actions={
          <Link href="/automations?edit=new">
            <Button><Plus className="h-4 w-4" /> New automation</Button>
          </Link>
        }
      />
      <Tabs
        active={`/automations?tab=${tab}`}
        tabs={[
          { href: "/automations?tab=automations", label: "Automations", count: automations.length },
          { href: "/automations?tab=runs", label: "Run history", count: failed || undefined },
          { href: "/automations?tab=events", label: "Event log" },
          { href: "/automations?tab=jobs", label: "Background jobs" },
        ]}
      />

      {edit && (
        <Card className="mb-6 p-4">
          <AutomationBuilder
            action={saveAutomation.bind(null, editing?.id ?? null)}
            events={EVENT_CATALOG}
            actions={actionMeta}
            pipelines={pipelines}
            sequences={sequences}
            initial={editing ? { ...editing, conditions: editing.conditions.map((c) => ({ ...c, value: c.value == null ? "" : String(c.value) })), actions: editing.actions.map((a) => ({ type: a.type, params: Object.fromEntries(Object.entries(a.params).map(([k, v]) => [k, String(v ?? "")])) })) } : undefined}
          />
        </Card>
      )}

      {tab === "automations" &&
        (automations.length === 0 ? (
          <EmptyState icon={<Workflow className="h-8 w-8" />} title="No automations yet" />
        ) : (
          <div className="space-y-3">
            {automations.map((a) => {
              const last = runs.find((r) => r.automationId === a.id);
              return (
                <Card key={a.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <form action={toggleAutomation.bind(null, a.id, !a.enabled)}>
                      <button className={`h-6 w-11 rounded-full p-0.5 transition ${a.enabled ? "bg-brand" : "bg-zinc-300"}`} title={a.enabled ? "On" : "Off"}>
                        <span className={`block h-5 w-5 rounded-full bg-white transition ${a.enabled ? "translate-x-5" : ""}`} />
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-zinc-500">
                        When <span className="text-brand">{EVENT_CATALOG.find((e) => e.type === a.trigger)?.label ?? a.trigger}</span>
                        {a.conditions.length > 0 && ` · ${a.conditions.length} condition${a.conditions.length > 1 ? "s" : ""}`} → {a.actions.map((x) => ACTIONS.find((d) => d.type === x.type)?.label ?? x.type).join(" → ")}
                      </p>
                      {a.description && <p className="text-xs text-zinc-400">{a.description}</p>}
                    </div>
                    {last && <Badge tone={statusTone(last.status)}>last: {last.status} {timeAgo(last.startedAt)}</Badge>}
                    <Link href={`/automations?edit=${a.id}`}><Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button></Link>
                    <form action={deleteAutomation.bind(null, a.id)}><Button variant="ghost" size="icon"><Trash2 className="h-4 w-4" /></Button></form>
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-brand">Test run</summary>
                    <form action={runTest.bind(null, a.id)} className="mt-2 flex flex-wrap gap-2">
                      <Select name="contactId" className="max-w-56">
                        <option value="">No contact</option>
                        {contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
                      </Select>
                      <Input name="payload" placeholder='Event payload JSON, e.g. {"urgency":"urgent"}' className="flex-1" />
                      <Button size="md" variant="outline"><Play className="h-4 w-4" /> Run now</Button>
                    </form>
                  </details>
                </Card>
              );
            })}
          </div>
        ))}

      {tab === "runs" && (
        <>
          <div className="mb-3 flex gap-2 text-sm">
            <Link href="/automations?tab=runs" className={!status ? "font-semibold text-brand" : "text-zinc-500"}>All</Link>
            <Link href="/automations?tab=runs&status=failed" className={status === "failed" ? "font-semibold text-brand" : "text-zinc-500"}>Failed only</Link>
          </div>
          <Card className="divide-y divide-zinc-100">
            {runs.filter((r) => !status || r.status === status).map((r) => (
              <details key={r.id} className="px-4 py-3" open={r.status === "failed"}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-auto text-xs text-zinc-400">{fmtDate(r.startedAt, tz)}</span>
                </summary>
                {r.error && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{r.error}</p>}
                <ol className="mt-2 space-y-1 text-xs">
                  {r.steps.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <Badge tone={s.status === "ok" ? "green" : s.status === "error" ? "red" : "default"}>{s.status}</Badge>
                      <span>{s.action}</span>
                      <span className="text-zinc-500">{s.detail}</span>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
            {runs.length === 0 && <p className="p-4 text-sm text-zinc-500">No runs yet.</p>}
          </Card>
        </>
      )}

      {tab === "events" && <EventLog tz={tz} />}

      {tab === "jobs" && (
        <Card className="divide-y divide-zinc-100">
          {jobs.length === 0 && <p className="p-4 text-sm text-zinc-500">No background jobs yet. Video processing, transcription, voice and music generation run here.</p>}
          {jobs.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
              <Badge tone={statusTone(j.status)}>{j.status}</Badge>
              <span className="font-medium">{j.type}</span>
              <span className="text-xs text-zinc-400">attempts {j.attempts} · {timeAgo(j.createdAt)}</span>
              {j.error && <span className="w-full text-xs text-red-600">{j.error}</span>}
              {(j.status === "failed" || j.status === "queued") && (
                <form action={retryJob.bind(null, j.id)} className="ml-auto">
                  <Button size="sm" variant="outline">Run now</Button>
                </form>
              )}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

async function EventLog({ tz }: { tz: string }) {
  const db = await getDb();
  const events = await db.select().from(schema.events).orderBy(desc(schema.events.createdAt)).limit(150);
  const runsByEvent = await db.select({ eventId: schema.automationRuns.eventId, status: schema.automationRuns.status }).from(schema.automationRuns).where(eq(schema.automationRuns.status, "failed"));
  return (
    <Card className="divide-y divide-zinc-100">
      {events.length === 0 && <p className="p-4 text-sm text-zinc-500">No events yet.</p>}
      {events.map((e) => (
        <details key={e.id} className="px-4 py-2">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
            <code className="rounded bg-brand-soft px-1.5 text-xs text-brand">{e.type}</code>
            <span className="text-xs text-zinc-500">from {e.source}</span>
            {!e.processedAt && <Badge tone="amber">not processed</Badge>}
            {runsByEvent.some((r) => r.eventId === e.id) && <Badge tone="red">automation failed</Badge>}
            <span className="ml-auto text-xs text-zinc-400">{fmtDate(e.createdAt, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-zinc-50 p-2 text-xs">{JSON.stringify(e.payload, null, 2)}</pre>
        </details>
      ))}
    </Card>
  );
}
