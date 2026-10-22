import Link from "next/link";
import { desc, eq, count } from "drizzle-orm";
import { Repeat } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { EVENT_CATALOG } from "@/lib/events";
import { PageHeader, Card, CardHeader, Badge, EmptyState, Input, Button, Field, Select, Tabs } from "@/components/ui";
import { createSequence } from "../actions";

export const metadata = { title: "Sequences" };

export default async function SequencesPage() {
  const db = await getDb();
  const seqs = await db.select().from(schema.sequences).orderBy(desc(schema.sequences.createdAt));
  const stepCounts = await db.select({ id: schema.sequenceSteps.sequenceId, n: count() }).from(schema.sequenceSteps).groupBy(schema.sequenceSteps.sequenceId);
  const active = await db
    .select({ id: schema.enrollments.sequenceId, n: count() })
    .from(schema.enrollments)
    .where(eq(schema.enrollments.status, "active"))
    .groupBy(schema.enrollments.sequenceId);
  const label = (t: string | null) => EVENT_CATALOG.find((e) => e.type === t)?.label ?? "Manual enrollment only";

  return (
    <>
      <PageHeader title="Email & Text" subtitle="Sequences: timed follow-ups that start from an event. Each step becomes a draft for your approval." />
      <Tabs active="/campaigns/sequences" tabs={[{ href: "/campaigns", label: "Broadcasts" }, { href: "/campaigns/sequences", label: "Sequences" }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {seqs.length === 0 ? (
            <EmptyState icon={<Repeat className="h-8 w-8" />} title="No sequences yet">
              e.g. “New lead → welcome email today, check-in text in 2 days, invitation in a week”.
            </EmptyState>
          ) : (
            <Card className="divide-y divide-zinc-100">
              {seqs.map((s) => (
                <Link key={s.id} href={`/campaigns/sequences/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-brand-soft/40">
                  <div className="flex-1">
                    <p className="font-medium text-brand-ink">{s.name}</p>
                    <p className="text-xs text-zinc-500">
                      {label(s.trigger)} · {stepCounts.find((x) => x.id === s.id)?.n ?? 0} steps · {active.find((x) => x.id === s.id)?.n ?? 0} active
                    </p>
                  </div>
                  <Badge tone={s.active ? "green" : "default"}>{s.active ? "On" : "Off"}</Badge>
                </Link>
              ))}
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="New sequence" />
          <form action={createSequence} className="space-y-3 p-4">
            <Field label="Name">
              <Input name="name" placeholder="New lead welcome" required />
            </Field>
            <Field label="Starts when">
              <Select name="trigger" defaultValue="lead.captured">
                <option value="">Manual enrollment only</option>
                {EVENT_CATALOG.filter((e) => e.fields.includes("contactId")).map((e) => (
                  <option key={e.type} value={e.type}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button className="w-full">Create</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
