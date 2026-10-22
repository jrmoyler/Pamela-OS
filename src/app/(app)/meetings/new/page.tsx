import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { contactName } from "@/lib/crm";
import { PageHeader } from "@/components/ui";
import { Recorder } from "@/components/meetings/Recorder";

export const metadata = { title: "Record a meeting" };

export default async function NewMeeting({ searchParams }: { searchParams: Promise<{ contact?: string }> }) {
  const { contact } = await searchParams;
  const db = await getDb();
  const contacts = await db.select().from(schema.contacts).orderBy(asc(schema.contacts.firstName)).limit(1000);
  const deals = await db
    .select({ d: schema.deals, p: schema.pipelines })
    .from(schema.deals)
    .innerJoin(schema.pipelines, eq(schema.deals.pipelineId, schema.pipelines.id))
    .where(eq(schema.deals.status, "open"))
    .limit(500);
  return (
    <>
      <PageHeader title="Record a meeting" subtitle="Audio stays in your storage. The transcript, summary and tasks land in Pamela OS." />
      <Recorder
        contacts={contacts.map((c) => ({ id: c.id, label: contactName(c) }))}
        deals={deals.map(({ d, p }) => ({ id: d.id, label: `${d.title} · ${p.name}` }))}
        defaultContactId={contact}
      />
    </>
  );
}
