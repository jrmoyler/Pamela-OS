import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { PageHeader, Card, Input, Button, Field } from "@/components/ui";
import { money } from "@/lib/utils";
import { createPipeline } from "./actions";

export const metadata = { title: "Pipelines" };

export default async function PipelinesPage() {
  const db = await getDb();
  const pipelines = await db.select().from(schema.pipelines).orderBy(asc(schema.pipelines.position));
  const deals = await db.select({ d: schema.deals }).from(schema.deals).where(eq(schema.deals.status, "open"));
  return (
    <>
      <PageHeader title="Pipelines" subtitle="One pipeline per business line. Drag deals between stages." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pipelines.map((p) => {
          const open = deals.filter((x) => x.d.pipelineId === p.id);
          return (
            <Link key={p.id} href={`/pipelines/${p.id}`}>
              <Card className="h-full p-5 transition hover:border-brand/40">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{p.businessLine}</p>
                <p className="mt-1 text-lg font-bold text-brand-ink">{p.name}</p>
                <p className="mt-3 text-sm text-zinc-600">
                  <span className="text-2xl font-bold text-brand">{open.length}</span> open
                  {open.some((x) => x.d.valueCents) && ` · ${money(open.reduce((s, x) => s + x.d.valueCents, 0))}`}
                </p>
              </Card>
            </Link>
          );
        })}
        <Card className="p-5">
          <form action={createPipeline} className="space-y-2">
            <Field label="New pipeline"><Input name="name" placeholder="e.g. Book launch" required /></Field>
            <Input name="businessLine" placeholder="Business line" />
            <Input name="stages" placeholder="Stages, comma separated" />
            <Button variant="outline" size="sm" className="w-full">Create</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
