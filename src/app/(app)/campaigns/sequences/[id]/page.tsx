import { notFound } from "next/navigation";
import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { ArrowDown, ArrowUp, Trash2, Mail, MessageSquare } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { EVENT_CATALOG } from "@/lib/events";
import { contactName } from "@/lib/crm";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, CardHeader, Badge, Input, Textarea, Button, Field, Select, Tabs, statusTone } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { saveSequence, addStep, saveStep, moveStep, deleteStep, manualEnroll, stopEnrollment, deleteSequence } from "../../actions";

export const metadata = { title: "Sequence" };

function splitDelay(min: number): { value: number; unit: number } {
  if (min > 0 && min % 1440 === 0) return { value: min / 1440, unit: 1440 };
  if (min > 0 && min % 60 === 0) return { value: min / 60, unit: 60 };
  return { value: min, unit: 1 };
}

function DelayInput({ minutes }: { minutes: number }) {
  const d = splitDelay(minutes);
  return (
    <div className="flex gap-2">
      <Input name="delay" type="number" min="0" defaultValue={d.value} className="w-24" />
      <Select name="unit" defaultValue={String(d.unit)} className="w-32">
        <option value="1">minutes</option>
        <option value="60">hours</option>
        <option value="1440">days</option>
      </Select>
    </div>
  );
}

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ids are uuids; anything else would make Postgres throw (500) instead of a 404.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [seq] = await db.select().from(schema.sequences).where(eq(schema.sequences.id, id));
  if (!seq) notFound();
  const [steps, enrollments, contacts, tz] = await Promise.all([
    db.select().from(schema.sequenceSteps).where(eq(schema.sequenceSteps.sequenceId, id)).orderBy(asc(schema.sequenceSteps.position)),
    db
      .select({ e: schema.enrollments, c: schema.contacts })
      .from(schema.enrollments)
      .innerJoin(schema.contacts, eq(schema.enrollments.contactId, schema.contacts.id))
      .where(eq(schema.enrollments.sequenceId, id))
      .orderBy(desc(schema.enrollments.createdAt))
      .limit(200),
    db.select().from(schema.contacts).orderBy(schema.contacts.firstName),
    getSetting("timezone"),
  ]);
  const [filterKey, filterValue] = Object.entries(seq.triggerFilter ?? {})[0] ?? ["", ""];
  const trigger = EVENT_CATALOG.find((e) => e.type === seq.trigger);

  return (
    <>
      <PageHeader title={seq.name} subtitle={<Badge tone={seq.active ? "green" : "default"}>{seq.active ? "On — enrolling" : "Off"}</Badge>} />
      <Tabs active="/campaigns/sequences" tabs={[{ href: "/campaigns", label: "Broadcasts" }, { href: "/campaigns/sequences", label: "Sequences" }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {steps.map((s, i) => (
            <Card key={s.id}>
              <div className="flex items-center gap-1 border-b border-zinc-100 px-3 py-2">
                <span className="flex flex-1 items-center gap-2 text-sm font-semibold text-brand">
                  {s.channel === "sms" ? <MessageSquare className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                  Step {i + 1}
                </span>
                <form action={moveStep.bind(null, id, s.id, -1)}>
                  <Button size="icon" variant="ghost" disabled={i === 0} title="Move up">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </form>
                <form action={moveStep.bind(null, id, s.id, 1)}>
                  <Button size="icon" variant="ghost" disabled={i === steps.length - 1} title="Move down">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </form>
                <form action={deleteStep.bind(null, id, s.id)}>
                  <Button size="icon" variant="ghost" className="text-red-600" title="Delete step">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </form>
              </div>
              <form action={saveStep.bind(null, id, s.id)} className="space-y-3 p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={i === 0 ? "Wait after enrolling" : "Wait after previous step"}>
                    <DelayInput minutes={s.delayMinutes} />
                  </Field>
                  <Field label="Channel">
                    <Select name="channel" defaultValue={s.channel} className="w-36">
                      <option value="email">Email</option>
                      <option value="sms">Text</option>
                    </Select>
                  </Field>
                </div>
                {s.channel === "email" && (
                  <Field label="Subject">
                    <Input name="subject" defaultValue={s.subject ?? ""} />
                  </Field>
                )}
                <Field label="Message" hint="{{first_name}} personalizes.">
                  <Textarea name="body" defaultValue={s.body} className="min-h-32 font-serif" />
                </Field>
                <Button size="sm" variant="outline">
                  Save step
                </Button>
              </form>
            </Card>
          ))}
          <Card>
            <form action={addStep.bind(null, id)} className="flex flex-wrap items-end gap-3 p-4">
              <Field label="Add a step after">
                <DelayInput minutes={1440} />
              </Field>
              <Field label="Channel">
                <Select name="channel" className="w-36">
                  <option value="email">Email</option>
                  <option value="sms">Text</option>
                </Select>
              </Field>
              <Button>Add step</Button>
            </form>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Settings" />
            <form action={saveSequence.bind(null, id)} className="space-y-3 p-4">
              <Field label="Name">
                <Input name="name" defaultValue={seq.name} />
              </Field>
              <Field label="Starts when">
                <Select name="trigger" defaultValue={seq.trigger ?? ""}>
                  <option value="">Manual enrollment only</option>
                  {EVENT_CATALOG.filter((e) => e.fields.includes("contactId")).map((e) => (
                    <option key={e.type} value={e.type}>
                      {e.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Only when" hint={trigger ? `Optional. Event fields: ${trigger.fields.join(", ")}` : "Optional event filter"}>
                <div className="flex gap-2">
                  <Input name="filterKey" defaultValue={filterKey} placeholder="field e.g. formId" />
                  <Input name="filterValue" defaultValue={String(filterValue)} placeholder="equals…" />
                </div>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={seq.active} className="accent-brand" /> Sequence is on
              </label>
              <Button className="w-full">Save</Button>
            </form>
          </Card>
          <Card>
            <CardHeader title="Enroll someone" />
            <form action={manualEnroll.bind(null, id)} className="flex gap-2 p-4">
              <Select name="contactId" required>
                <option value="">Choose…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {contactName(c)}
                  </option>
                ))}
              </Select>
              <Button variant="outline">Enroll</Button>
            </form>
          </Card>
          <Card>
            <CardHeader title="Enrolled" subtitle={`${enrollments.filter((x) => x.e.status === "active").length} active`} />
            <ul className="divide-y divide-zinc-100 text-sm">
              {enrollments.length === 0 && <li className="px-4 py-3 text-zinc-500">Nobody yet.</li>}
              {enrollments.map(({ e, c }) => (
                <li key={e.id} className="flex items-center gap-2 px-4 py-2">
                  <div className="flex-1">
                    <Link href={`/contacts/${c.id}`} className="font-medium hover:text-brand">
                      {contactName(c)}
                    </Link>
                    <p className="text-xs text-zinc-500">
                      Step {Math.min(e.nextStep + 1, steps.length)} of {steps.length}
                      {e.nextRunAt && e.status === "active" && ` · next ${fmtDate(e.nextRunAt, tz)}`}
                    </p>
                  </div>
                  <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                  {e.status === "active" && (
                    <form action={stopEnrollment.bind(null, id, e.id)}>
                      <Button size="sm" variant="ghost">
                        Stop
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <form action={deleteSequence.bind(null, id)}>
            <Button variant="ghost" size="sm" className="text-red-600">
              <Trash2 className="h-4 w-4" /> Delete sequence
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
