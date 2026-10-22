import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowDown, ArrowUp, Trash2, ExternalLink, AlertTriangle } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { BLOCK_DEFS, blockDef, PAGE_TEMPLATES } from "@/lib/modules/funnels";
import { lintBrand } from "@/lib/brand";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, CardHeader, Badge, Input, Textarea, Button, Field, Select } from "@/components/ui";
import { PageBlocks } from "@/components/funnels/Blocks";
import { addBlock, updateBlock, moveBlock, deleteBlock, updatePageMeta, requestPublish, unpublishPage, deletePage } from "../../actions";

export const metadata = { title: "Page builder" };

export default async function PageBuilder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ids are uuids; anything else would make Postgres throw (500) instead of a 404.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [page] = await db.select().from(schema.pages).where(eq(schema.pages.id, id));
  if (!page) notFound();
  const [forms, bookingTypes, pendingPublish, kit] = await Promise.all([
    db.select({ id: schema.forms.id, name: schema.forms.name }).from(schema.forms),
    db.select({ slug: schema.bookingTypes.slug, name: schema.bookingTypes.name }).from(schema.bookingTypes),
    db
      .select({ id: schema.approvals.id })
      .from(schema.approvals)
      .where(and(eq(schema.approvals.kind, "publish_page"), eq(schema.approvals.subjectId, id), eq(schema.approvals.status, "pending"))),
    getSetting("brandKit"),
  ]);
  const allText = page.blocks.flatMap((b) => Object.values(b.props).filter((v): v is string => typeof v === "string")).join("\n");
  const issues = lintBrand(allText, kit);

  return (
    <>
      <PageHeader
        title={page.title}
        subtitle={
          <span>
            /p/{page.slug} · <Badge tone={page.published ? "green" : "default"}>{page.published ? "Live" : "Draft"}</Badge> · {page.views} views
          </span>
        }
        actions={
          <>
            {page.published && (
              <>
                <Link href={`/p/${page.slug}`}>
                  <Button variant="outline">
                    <ExternalLink className="h-4 w-4" /> View live
                  </Button>
                </Link>
                <form action={unpublishPage.bind(null, id)}>
                  <Button variant="ghost">Unpublish</Button>
                </form>
              </>
            )}
            {pendingPublish.length ? (
              <Link href="/approvals">
                <Button variant="soft">Publish waiting in Approvals</Button>
              </Link>
            ) : (
              <form action={requestPublish.bind(null, id)}>
                <Button>{page.published ? "Publish changes" : "Request publish"}</Button>
              </form>
            )}
          </>
        }
      />
      {page.published && (
        <p className="-mt-4 mb-4 text-xs text-zinc-500">Edits to a live page show immediately; use Unpublish to take it down.</p>
      )}
      {issues.length > 0 && (
        <div className="mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <ul>
            {issues.map((i) => (
              <li key={i.code}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-5">
          <Card>
            <CardHeader title="Page settings" />
            <form action={updatePageMeta.bind(null, id)} className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Title" className="sm:col-span-2">
                <Input name="title" defaultValue={page.title} />
              </Field>
              <Field label="Web address">
                <Input name="slug" defaultValue={page.slug} />
              </Field>
              <Field label="Type">
                <Select name="kind" defaultValue={page.kind}>
                  {[...new Set(Object.values(PAGE_TEMPLATES).map((t) => t.kind))].map((k) => (
                    <option key={k} value={k}>
                      {k.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="outline" size="sm" className="sm:col-span-2">
                Save settings
              </Button>
            </form>
          </Card>

          {page.blocks.map((b, i) => {
            const def = blockDef(b.type);
            if (!def) return null;
            return (
              <Card key={b.id}>
                <div className="flex items-center gap-1 border-b border-zinc-100 px-3 py-2">
                  <span className="flex-1 text-sm font-semibold text-brand">
                    {i + 1}. {def.label}
                  </span>
                  <form action={moveBlock.bind(null, id, b.id, -1)}>
                    <Button size="icon" variant="ghost" title="Move up" disabled={i === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                  </form>
                  <form action={moveBlock.bind(null, id, b.id, 1)}>
                    <Button size="icon" variant="ghost" title="Move down" disabled={i === page.blocks.length - 1}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </form>
                  <form action={deleteBlock.bind(null, id, b.id)}>
                    <Button size="icon" variant="ghost" title="Delete block" className="text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </form>
                </div>
                <form action={updateBlock.bind(null, id, b.id)} className="space-y-3 p-3">
                  {def.fields.map((f) => {
                    const v = b.props[f.key];
                    const str = v == null ? "" : String(v);
                    switch (f.type) {
                      case "textarea":
                        return (
                          <Field key={f.key} label={f.label} hint={f.hint}>
                            <Textarea name={f.key} defaultValue={str} className="min-h-20" />
                          </Field>
                        );
                      case "money":
                        return (
                          <Field key={f.key} label={f.label}>
                            <Input name={f.key} type="number" step="0.01" min="0" defaultValue={v ? (Number(v) / 100).toFixed(2) : ""} />
                          </Field>
                        );
                      case "file":
                        return (
                          <Field key={f.key} label={f.label}>
                            <input name={f.key} type="file" accept={b.type === "video" ? "video/*" : "image/*"} className="block w-full text-sm" />
                            {str && (
                              <label className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                                <input type="checkbox" name={`remove_${f.key}`} className="accent-brand" /> Remove current file
                              </label>
                            )}
                          </Field>
                        );
                      case "form":
                        return (
                          <Field key={f.key} label={f.label} hint={forms.length ? undefined : "Create a form in the Forms tab first."}>
                            <Select name={f.key} defaultValue={str}>
                              <option value="">Choose a form…</option>
                              {forms.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        );
                      case "booking":
                        return (
                          <Field key={f.key} label={f.label}>
                            <Select name={f.key} defaultValue={str}>
                              <option value="">All booking types</option>
                              {bookingTypes.map((x) => (
                                <option key={x.slug} value={x.slug}>
                                  {x.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        );
                      default:
                        return (
                          <Field key={f.key} label={f.label} hint={f.hint}>
                            <Input name={f.key} defaultValue={str} />
                          </Field>
                        );
                    }
                  })}
                  <Button size="sm" variant="outline">
                    Save block
                  </Button>
                </form>
              </Card>
            );
          })}

          <Card>
            <form action={addBlock.bind(null, id)} className="flex gap-2 p-3">
              <Select name="type">
                {BLOCK_DEFS.map((d) => (
                  <option key={d.type} value={d.type}>
                    {d.label}
                  </option>
                ))}
              </Select>
              <Button>Add block</Button>
            </form>
          </Card>
          <form action={deletePage.bind(null, id)}>
            <Button variant="ghost" size="sm" className="text-red-600">
              <Trash2 className="h-4 w-4" /> Delete page
            </Button>
          </form>
        </div>
        <div className="xl:col-span-7">
          <div className="sticky top-16">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Preview</p>
            <Card className="max-h-[80vh] overflow-y-auto">
              <PageBlocks blocks={page.blocks} preview pageSlug={page.slug} />
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
