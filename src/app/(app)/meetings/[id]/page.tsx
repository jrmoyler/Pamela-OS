import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { Mail, RefreshCw, ListChecks, Trash2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { contactName } from "@/lib/crm";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Textarea, Select, Field, statusTone } from "@/components/ui";
import { fmtDate, fmtDuration } from "@/lib/utils";
import { saveSummary, saveActionItems, createTasks, renameSpeaker, reprocess, draftFollowUp, deleteMeeting } from "../actions";

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const db = await getDb();
  const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id));
  if (!m) notFound();
  const tz = await getSetting("timezone");
  const contacts = await db.select().from(schema.contacts).orderBy(asc(schema.contacts.firstName)).limit(1000);
  const deals = await db.select().from(schema.deals).limit(500);
  const contact = contacts.find((c) => c.id === m.contactId);
  const speakers = [...new Set([...m.speakers, ...m.segments.map((s) => s.speaker)])].filter(Boolean);
  const openTasks = m.actionItems.filter((a) => !a.taskId).length;

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={
          <>
            {fmtDate(m.startedAt, tz)} · {fmtDuration(m.durationSec)}
            {contact && (
              <>
                {" · "}
                <Link href={`/contacts/${contact.id}`} className="text-brand underline">{contactName(contact)}</Link>
              </>
            )}
          </>
        }
        actions={
          <>
            <Badge tone={statusTone(m.status)}>{m.status}</Badge>
            <form action={reprocess.bind(null, id)}><Button variant="outline" size="sm"><RefreshCw className="h-4 w-4" /> Re-process</Button></form>
          </>
        }
      />
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {m.status === "failed" && m.error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">Processing failed: {m.error}</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {m.audioFileId && (
            <Card className="p-4">
              <audio controls preload="metadata" src={`/api/files/${m.audioFileId}`} className="w-full" />
            </Card>
          )}
          <Card>
            <CardHeader title="Summary" />
            <form action={saveSummary.bind(null, id)} className="space-y-3 p-4">
              <Field label="Title"><Input name="title" defaultValue={m.title} /></Field>
              <Textarea name="summary" defaultValue={m.summary ?? ""} className="min-h-32 font-serif text-base leading-relaxed" />
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Contact">
                  <Select name="contactId" defaultValue={m.contactId ?? ""}>
                    <option value="">— none —</option>
                    {contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
                  </Select>
                </Field>
                <Field label="Deal">
                  <Select name="dealId" defaultValue={m.dealId ?? ""}>
                    <option value="">— none —</option>
                    {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </Select>
                </Field>
              </div>
              <Button size="sm">Save</Button>
            </form>
          </Card>
          <Card>
            <CardHeader title="Transcript" subtitle={`${m.segments.length} segments`} />
            <div className="max-h-[60vh] space-y-2 overflow-y-auto p-4 text-sm">
              {m.segments.length ? (
                m.segments.map((s, i) => (
                  <p key={i}>
                    <span className="mr-2 text-xs tabular-nums text-zinc-400">{fmtDuration(s.start)}</span>
                    <span className="mr-1 font-semibold text-brand">{s.speaker}:</span>
                    {s.text}
                  </p>
                ))
              ) : (
                <p className="whitespace-pre-wrap">{m.transcript || "No transcript."}</p>
              )}
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Action items"
              action={
                openTasks > 0 ? (
                  <form action={createTasks.bind(null, id)}><Button size="sm"><ListChecks className="h-4 w-4" /> Create {openTasks} task{openTasks === 1 ? "" : "s"}</Button></form>
                ) : undefined
              }
            />
            <form action={saveActionItems.bind(null, id)} className="space-y-2 p-4">
              {m.actionItems.map((a, i) => (
                <div key={i} className="space-y-1 rounded-lg border border-zinc-200 p-2">
                  <Textarea name="text" defaultValue={a.text} className="min-h-12 text-sm" />
                  <div className="flex gap-1">
                    <Input name="owner" defaultValue={a.owner ?? ""} placeholder="Owner" className="h-8 text-xs" />
                    <Input name="due" defaultValue={a.due ?? ""} placeholder="Due" className="h-8 text-xs" />
                  </div>
                  <input type="hidden" name="taskId" value={a.taskId ?? ""} />
                  {a.taskId && <Badge tone="green">task created</Badge>}
                </div>
              ))}
              <Input name="newItem" placeholder="Add an action item…" />
              <Button size="sm" variant="outline" className="w-full">Save action items</Button>
            </form>
          </Card>
          <Card>
            <CardHeader title="Follow-up" subtitle="RJ drafts it in your voice → Approvals." />
            <form action={draftFollowUp.bind(null, id)} className="space-y-2 p-4">
              <Textarea name="instructions" placeholder="Anything to add? (optional)" className="min-h-16" />
              <Button className="w-full" variant="outline" disabled={!contact?.email}><Mail className="h-4 w-4" /> Draft follow-up email</Button>
              {!contact?.email && <p className="text-xs text-zinc-500">Link a contact with an email first.</p>}
            </form>
          </Card>
          {speakers.length > 0 && (
            <Card>
              <CardHeader title="Speakers" />
              <form action={renameSpeaker.bind(null, id)} className="space-y-2 p-4">
                <Select name="from">{speakers.map((s) => <option key={s}>{s}</option>)}</Select>
                <Input name="to" placeholder="Rename to…" />
                <Button size="sm" variant="outline" className="w-full">Rename speaker</Button>
              </form>
            </Card>
          )}
          <form action={deleteMeeting.bind(null, id)}>
            <Button variant="ghost" size="sm" className="text-red-600"><Trash2 className="h-4 w-4" /> Delete meeting</Button>
          </form>
        </div>
      </div>
    </>
  );
}
