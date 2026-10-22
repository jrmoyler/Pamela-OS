import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Mic, Plus } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { contactName } from "@/lib/crm";
import { PageHeader, Card, Badge, Button, EmptyState, statusTone } from "@/components/ui";
import { fmtDate, fmtDuration } from "@/lib/utils";

export const metadata = { title: "Meetings" };

export default async function MeetingsPage() {
  const db = await getDb();
  const tz = await getSetting("timezone");
  const rows = await db
    .select({ m: schema.meetings, c: schema.contacts })
    .from(schema.meetings)
    .leftJoin(schema.contacts, eq(schema.meetings.contactId, schema.contacts.id))
    .orderBy(desc(schema.meetings.startedAt))
    .limit(200);
  return (
    <>
      <PageHeader
        title="Meetings"
        subtitle="Record → transcript → summary → action items → tasks and CRM notes, automatically."
        actions={<Link href="/meetings/new"><Button><Plus className="h-4 w-4" /> Record a meeting</Button></Link>}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Mic className="h-8 w-8" />} title="No meetings yet">Tap “Record a meeting” at the start of your next call or sit-down.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map(({ m, c }) => (
            <Link key={m.id} href={`/meetings/${m.id}`}>
              <Card className="h-full p-4 transition hover:border-brand/40">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-brand-ink">{m.title}</h2>
                  <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {fmtDate(m.startedAt, tz)} · {fmtDuration(m.durationSec)}
                  {c && ` · ${contactName(c)}`}
                </p>
                {m.summary && <p className="mt-2 line-clamp-3 font-serif text-sm text-zinc-700">{m.summary}</p>}
                {m.actionItems.length > 0 && <p className="mt-2 text-xs font-medium text-brand">{m.actionItems.length} action items</p>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
