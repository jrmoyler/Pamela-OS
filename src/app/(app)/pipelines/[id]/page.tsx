import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { contactName } from "@/lib/crm";
import { PageHeader, Card, Input, Button, Select } from "@/components/ui";
import { Kanban } from "@/components/work/Kanban";
import { money, timeAgo } from "@/lib/utils";
import { moveDeal, createDeal, addStage } from "../actions";

export default async function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [pipeline] = await db.select().from(schema.pipelines).where(eq(schema.pipelines.id, id));
  if (!pipeline) notFound();
  const stages = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.pipelineId, id)).orderBy(asc(schema.pipelineStages.position));
  const deals = await db
    .select({ d: schema.deals, c: schema.contacts })
    .from(schema.deals)
    .leftJoin(schema.contacts, eq(schema.deals.contactId, schema.contacts.id))
    .where(eq(schema.deals.pipelineId, id));
  const all = await db.select().from(schema.pipelines).orderBy(asc(schema.pipelines.position));

  return (
    <>
      <PageHeader
        title={pipeline.name}
        subtitle={pipeline.businessLine}
        actions={
          <div className="flex flex-wrap gap-1">
            {all.map((p) => (
              <Link key={p.id} href={`/pipelines/${p.id}`} className={p.id === id ? "rounded-full bg-brand px-3 py-1 text-xs font-medium text-white" : "rounded-full bg-white px-3 py-1 text-xs text-zinc-600 ring-1 ring-zinc-200 hover:text-brand"}>
                {p.name}
              </Link>
            ))}
          </div>
        }
      />
      <Card className="mb-4 p-3">
        <form action={createDeal.bind(null, id)} className="flex flex-wrap gap-2">
          <Input name="contact" placeholder="Person's name" className="w-48" />
          <Input name="email" type="email" placeholder="Email (optional)" className="w-52" />
          <Input name="title" placeholder="Deal title" className="min-w-40 flex-1" />
          <Input name="value" type="number" step="0.01" placeholder="$ value" className="w-28" />
          <Select name="stageId" className="w-44">
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Button>Add deal</Button>
        </form>
      </Card>
      <Kanban
        columns={stages.map((s) => {
          const v = deals.filter((x) => x.d.stageId === s.id).reduce((sum, x) => sum + x.d.valueCents, 0);
          return { key: s.id, name: s.name, hint: v ? money(v) : undefined };
        })}
        onMove={moveDeal}
        cards={deals.map(({ d, c }) => ({
          id: d.id,
          columnKey: d.stageId,
          position: d.position,
          title: d.title,
          href: c ? `/contacts/${c.id}` : undefined,
          subtitle: [c ? contactName(c) : null, d.valueCents ? money(d.valueCents) : null, `updated ${timeAgo(d.updatedAt)}`].filter(Boolean).join(" · "),
        }))}
        footers={
          stages.length
            ? {
                [stages.at(-1)!.id]: (
                  <form action={addStage.bind(null, id)} className="mt-2 flex gap-1">
                    <Input name="name" placeholder="+ add stage" className="h-8 text-xs" />
                  </form>
                ),
              }
            : undefined
        }
      />
    </>
  );
}
