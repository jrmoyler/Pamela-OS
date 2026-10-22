import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, ne, and } from "drizzle-orm";
import { Mail, MessageSquare, Trash2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { contactName, RELATIONSHIP_TYPES } from "@/lib/crm";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, CardHeader, Badge, Input, Textarea, Button, Field, Select, statusTone } from "@/components/ui";
import { Timeline } from "@/components/Timeline";
import { fmtDate, money } from "@/lib/utils";
import { updateContact, addNote, deleteContact, draftMessage, addDealForContact } from "../actions";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, id));
  if (!c) notFound();
  const tz = await getSetting("timezone");
  const [activities, deals, tasks, pipelines, bookings, meetings] = await Promise.all([
    db.select().from(schema.activities).where(eq(schema.activities.contactId, id)).orderBy(desc(schema.activities.occurredAt)).limit(200),
    db
      .select({ d: schema.deals, s: schema.pipelineStages, p: schema.pipelines })
      .from(schema.deals)
      .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
      .innerJoin(schema.pipelines, eq(schema.deals.pipelineId, schema.pipelines.id))
      .where(eq(schema.deals.contactId, id)),
    db.select().from(schema.tasks).where(and(eq(schema.tasks.contactId, id), ne(schema.tasks.status, "done"))),
    db.select().from(schema.pipelines).orderBy(schema.pipelines.position),
    db.select().from(schema.bookings).where(eq(schema.bookings.contactId, id)).orderBy(desc(schema.bookings.startsAt)).limit(10),
    db.select().from(schema.meetings).where(eq(schema.meetings.contactId, id)).orderBy(desc(schema.meetings.startedAt)).limit(10),
  ]);

  return (
    <>
      <PageHeader
        title={contactName(c)}
        subtitle={[c.title, c.company].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap gap-1">
            {c.relationshipTypes.map((r) => <Badge key={r} tone="brand">{r}</Badge>)}
            {c.doNotContact && <Badge tone="red">Do not contact</Badge>}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Log or note" />
            <form action={addNote.bind(null, id)} className="space-y-2 p-4">
              <Textarea name="body" placeholder="What happened? (tap the mic to dictate)" />
              <div className="flex gap-2">
                <Select name="type" className="max-w-40">
                  <option value="note">Note</option>
                  <option value="call">Call</option>
                  <option value="meeting">Meeting</option>
                  <option value="sms">Text</option>
                  <option value="email">Email</option>
                </Select>
                <Button>Add to timeline</Button>
              </div>
            </form>
          </Card>
          <Card>
            <CardHeader title="Ask RJ to draft a message" subtitle="Drafted in your voice and parked in Approvals — nothing sends without your yes." />
            <form action={draftMessage.bind(null, id)} className="space-y-2 p-4">
              <Textarea name="instructions" placeholder="e.g. Thank her for coming to the board meeting and ask about the March fundraiser" className="min-h-16" />
              <div className="flex gap-2">
                <Button name="channel" value="email" variant="outline" disabled={!c.email}>
                  <Mail className="h-4 w-4" /> Draft email
                </Button>
                <Button name="channel" value="sms" variant="outline" disabled={!c.phone}>
                  <MessageSquare className="h-4 w-4" /> Draft text
                </Button>
              </div>
            </form>
          </Card>
          <Card>
            <CardHeader title="Timeline" subtitle={`${activities.length} touchpoints`} />
            <Timeline items={activities} tz={tz} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <form action={updateContact.bind(null, id)} className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <Field label="First"><Input name="firstName" defaultValue={c.firstName} /></Field>
                <Field label="Last"><Input name="lastName" defaultValue={c.lastName} /></Field>
              </div>
              <Field label="Email"><Input name="email" defaultValue={c.email ?? ""} /></Field>
              <Field label="Phone"><Input name="phone" defaultValue={c.phone ?? ""} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Org"><Input name="company" defaultValue={c.company ?? ""} /></Field>
                <Field label="Title"><Input name="title" defaultValue={c.title ?? ""} /></Field>
              </div>
              <Field label="Tags"><Input name="tags" defaultValue={c.tags.join(", ")} /></Field>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Relationship</p>
                <div className="flex flex-wrap gap-1.5">
                  {RELATIONSHIP_TYPES.map((r) => (
                    <label key={r} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand">
                      <input type="checkbox" name="relationshipTypes" value={r} defaultChecked={c.relationshipTypes.includes(r)} className="accent-brand" /> {r}
                    </label>
                  ))}
                </div>
              </div>
              <Field label="Notes"><Textarea name="notes" defaultValue={c.notes ?? ""} className="min-h-16" /></Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="doNotContact" defaultChecked={c.doNotContact} className="accent-brand" /> Do not contact (excluded from campaigns)
              </label>
              <Button className="w-full">Save</Button>
            </form>
          </Card>
          <Card>
            <CardHeader title="Pipelines" />
            <div className="space-y-2 p-4">
              {deals.map(({ d, s, p }) => (
                <Link key={d.id} href={`/pipelines/${p.id}`} className="block rounded-lg border border-zinc-200 p-2 hover:border-brand/40">
                  <p className="text-sm font-medium">{d.title}</p>
                  <p className="text-xs text-zinc-500">
                    {p.name} · <span className="text-brand">{s.name}</span>
                    {d.valueCents > 0 && ` · ${money(d.valueCents)}`}
                  </p>
                </Link>
              ))}
              <form action={addDealForContact.bind(null, id)} className="space-y-2 border-t border-zinc-100 pt-3">
                <Select name="pipelineId">
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <div className="flex gap-2">
                  <Input name="title" placeholder="Deal title" />
                  <Input name="value" type="number" step="0.01" placeholder="$" className="w-24" />
                </div>
                <Button variant="outline" size="sm" className="w-full">Add to pipeline</Button>
              </form>
            </div>
          </Card>
          <Card>
            <CardHeader title="Open tasks" />
            <ul className="divide-y divide-zinc-100">
              {tasks.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">None.</li>}
              {tasks.map((t) => (
                <li key={t.id} className="px-4 py-2 text-sm">
                  {t.title}
                  {t.dueAt && <span className="ml-2 text-xs text-zinc-500">due {fmtDate(t.dueAt, tz, { month: "short", day: "numeric" })}</span>}
                </li>
              ))}
            </ul>
          </Card>
          {(bookings.length > 0 || meetings.length > 0) && (
            <Card>
              <CardHeader title="Bookings & meetings" />
              <ul className="divide-y divide-zinc-100 text-sm">
                {bookings.map((b) => (
                  <li key={b.id} className="flex items-center justify-between px-4 py-2">
                    <span>{b.title} · {fmtDate(b.startsAt, tz)}</span>
                    <Badge tone={statusTone(b.status)}>{b.status}</Badge>
                  </li>
                ))}
                {meetings.map((m) => (
                  <li key={m.id} className="px-4 py-2">
                    <Link href={`/meetings/${m.id}`} className="hover:text-brand">{m.title} · {fmtDate(m.startedAt, tz)}</Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <form action={deleteContact.bind(null, id)}>
            <Button variant="ghost" size="sm" className="text-red-600">
              <Trash2 className="h-4 w-4" /> Delete contact
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
