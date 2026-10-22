import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { RELATIONSHIP_TYPES, contactName } from "@/lib/crm";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, CardHeader, Input, Button, Field, Select } from "@/components/ui";
import { FunnelTabs } from "@/components/funnels/FunnelTabs";
import { fmtDate } from "@/lib/utils";
import { updateFormSettings, addField, updateField, moveField, deleteField, deleteForm } from "../../actions";

export const metadata = { title: "Form builder" };

const TYPES = [
  ["text", "Short text"],
  ["email", "Email"],
  ["tel", "Phone"],
  ["textarea", "Long text"],
  ["select", "Choice"],
] as const;

export default async function FormBuilder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [form] = await db.select().from(schema.forms).where(eq(schema.forms.id, id));
  if (!form) notFound();
  const [pipelines, stages, sequences, pages, lead, subs, tz] = await Promise.all([
    db.select().from(schema.pipelines).orderBy(asc(schema.pipelines.position)),
    db.select().from(schema.pipelineStages).orderBy(asc(schema.pipelineStages.position)),
    db.select({ id: schema.sequences.id, name: schema.sequences.name }).from(schema.sequences),
    db.select({ slug: schema.pages.slug, title: schema.pages.title }).from(schema.pages),
    form.leadMagnetFileId ? db.select().from(schema.files).where(eq(schema.files.id, form.leadMagnetFileId)) : Promise.resolve([]),
    db
      .select({ s: schema.formSubmissions, c: schema.contacts })
      .from(schema.formSubmissions)
      .leftJoin(schema.contacts, eq(schema.formSubmissions.contactId, schema.contacts.id))
      .where(eq(schema.formSubmissions.formId, id))
      .orderBy(desc(schema.formSubmissions.createdAt))
      .limit(25),
    getSetting("timezone"),
  ]);

  return (
    <>
      <PageHeader title={form.name} subtitle={`${form.submissions} submissions · add it to a page with the Form block`} />
      <FunnelTabs active="/funnels/forms" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Fields" />
            <div className="divide-y divide-zinc-100">
              {form.fields.map((f, i) => (
                <div key={f.key} className="p-3">
                  <div className="mb-2 flex items-center gap-1">
                    <code className="flex-1 text-xs text-zinc-500">{f.key}</code>
                    <form action={moveField.bind(null, id, f.key, -1)}>
                      <Button size="icon" variant="ghost" disabled={i === 0} title="Move up">
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                    </form>
                    <form action={moveField.bind(null, id, f.key, 1)}>
                      <Button size="icon" variant="ghost" disabled={i === form.fields.length - 1} title="Move down">
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </form>
                    <form action={deleteField.bind(null, id, f.key)}>
                      <Button size="icon" variant="ghost" className="text-red-600" title="Delete field">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </form>
                  </div>
                  <form action={updateField.bind(null, id, f.key)} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                    <Input name="label" defaultValue={f.label} />
                    <Select name="type" defaultValue={f.type}>
                      {TYPES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                    <label className="flex items-center gap-1 text-sm">
                      <input type="checkbox" name="required" defaultChecked={f.required} className="accent-brand" /> Required
                    </label>
                    <Input name="options" defaultValue={(f.options ?? []).join(", ")} placeholder="Choices (comma separated, for Choice fields)" className="sm:col-span-2" />
                    <Button size="sm" variant="outline">
                      Save
                    </Button>
                  </form>
                </div>
              ))}
            </div>
            <form action={addField.bind(null, id)} className="flex flex-wrap gap-2 border-t border-zinc-100 p-3">
              <Input name="label" placeholder="New field label" className="flex-1" required />
              <Select name="type" className="w-36">
                {TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="required" className="accent-brand" /> Required
              </label>
              <Button>Add field</Button>
            </form>
          </Card>
          <Card>
            <CardHeader title="Recent submissions" />
            <ul className="divide-y divide-zinc-100 text-sm">
              {subs.length === 0 && <li className="px-4 py-3 text-zinc-500">None yet.</li>}
              {subs.map(({ s, c }) => (
                <li key={s.id} className="px-4 py-2">
                  <a href={c ? `/contacts/${c.id}` : "#"} className="font-medium hover:text-brand">
                    {c ? contactName(c) : "Unknown"}
                  </a>
                  <span className="ml-2 text-xs text-zinc-500">{fmtDate(s.createdAt, tz)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="What happens on submit" />
            <form action={updateFormSettings.bind(null, id)} className="space-y-3 p-4">
              <Field label="Form name">
                <Input name="name" defaultValue={form.name} />
              </Field>
              <Field label="Tag the contact" hint="Comma separated">
                <Input name="tags" defaultValue={form.tags.join(", ")} />
              </Field>
              <Field label="Relationship">
                <Select name="relationshipType" defaultValue={form.relationshipType ?? ""}>
                  <option value="">—</option>
                  {RELATIONSHIP_TYPES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Add to pipeline">
                <Select name="stageId" defaultValue={form.stageId ?? ""}>
                  <option value="">Don&apos;t add to a pipeline</option>
                  {pipelines.map((p) => (
                    <optgroup key={p.id} label={p.name}>
                      {stages
                        .filter((s) => s.pipelineId === p.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {p.name} → {s.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Field label="Start a sequence">
                <Select name="sequenceId" defaultValue={form.sequenceId ?? ""}>
                  <option value="">None</option>
                  {sequences.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Thank-you page" hint="Default: a branded thank-you screen.">
                <Select name="thankYouSlug" defaultValue={form.thankYouSlug ?? ""}>
                  <option value="">Default thank-you</option>
                  {pages.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.title} (/p/{p.slug})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Lead magnet (delivered on the thank-you page)">
                <input type="file" name="leadMagnet" className="block w-full text-sm" />
                {lead[0] && (
                  <label className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                    Current: {lead[0].name}
                    <input type="checkbox" name="removeLeadMagnet" className="accent-brand" /> remove
                  </label>
                )}
              </Field>
              <Button className="w-full">Save</Button>
            </form>
          </Card>
          <form action={deleteForm.bind(null, id)}>
            <Button variant="ghost" size="sm" className="text-red-600">
              <Trash2 className="h-4 w-4" /> Delete form
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
