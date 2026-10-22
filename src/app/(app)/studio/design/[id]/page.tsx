import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Sparkles, Trash2, Wand2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Textarea, statusTone } from "@/components/ui";
import { DesignEditor } from "@/components/studio/DesignEditor";
import { TEMPLATES } from "@/components/studio/designTemplates";
import { fileUrl } from "@/lib/storage";
import { lintBrand } from "@/lib/brand";
import { getSetting } from "@/lib/settings";
import { canvaConfigured } from "@/lib/modules/design";
import { saveDesign, uploadPhoto, publishDesign, suggestCaption, canvaGenerate, deleteDesign } from "../actions";

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ids are uuids; anything else would make Postgres throw (500) instead of a 404.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [d] = await db.select().from(schema.designs).where(eq(schema.designs.id, id));
  if (!d) notFound();
  const t = TEMPLATES.find((x) => x.key === d.templateKey) ?? TEMPLATES[0];
  const kit = await getSetting("brandKit");
  const issues = lintBrand([d.fields.headline, d.fields.body, d.fields.date, d.fields.cta, d.fields.caption].filter(Boolean).join("\n"), kit);
  const canva = await canvaConfigured();
  const photoUrl = d.fields.photoFileId ? fileUrl(d.fields.photoFileId) : undefined;

  return (
    <>
      <PageHeader
        title={d.title}
        subtitle={<>{t.name} · <Badge tone={statusTone(d.status)}>{d.status}</Badge></>}
        actions={<Link href="/studio/design"><Button variant="ghost">All designs</Button></Link>}
      />
      {issues.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-semibold">Brand check</p>
          <ul className="list-disc pl-5">{issues.map((i) => <li key={i.code}>{i.message}</li>)}</ul>
        </Card>
      )}
      <DesignEditor design={{ id: d.id, title: d.title, templateKey: d.templateKey, fields: d.fields }} photoUrl={photoUrl} saveAction={saveDesign.bind(null, id)} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {t.fields.includes("photo") && (
          <Card>
            <CardHeader title="Photo" />
            <form action={uploadPhoto.bind(null, id)} className="space-y-2 p-4">
              <Input type="file" name="photo" accept="image/*" className="py-1.5" />
              <Button size="sm" variant="outline">Upload photo</Button>
            </form>
          </Card>
        )}
        <Card>
          <CardHeader title="Export" subtitle={d.exportFileId ? "Latest export" : "Export a PNG to publish"} />
          <div className="space-y-3 p-4">
            {d.exportFileId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(d.exportFileId)} alt="Export" className="max-h-64 rounded-lg border border-zinc-200" />
            ) : (
              <p className="text-sm text-zinc-500">No export yet.</p>
            )}
            {canva ? (
              <form action={canvaGenerate.bind(null, id)}>
                <Button size="sm" variant="outline"><Wand2 className="h-4 w-4" /> Generate in Canva (brand template)</Button>
              </form>
            ) : (
              <p className="text-xs text-zinc-500">Connect Canva in Settings to render with your Canva brand template.</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Publish" subtitle="Goes to Approvals — posts only after your yes." />
          <form className="space-y-2 p-4">
            <Textarea name="caption" defaultValue={d.fields.caption ?? ""} placeholder="Caption" className="min-h-24" />
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5"><input type="checkbox" name="platforms" value="instagram" defaultChecked className="accent-brand" /> Instagram</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="platforms" value="facebook" className="accent-brand" /> Facebook</label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" formAction={suggestCaption.bind(null, id)} variant="outline"><Sparkles className="h-4 w-4" /> RJ caption</Button>
              <Button size="sm" formAction={publishDesign.bind(null, id)} disabled={!d.exportFileId}>Send for approval</Button>
            </div>
          </form>
        </Card>
      </div>
      <form action={deleteDesign.bind(null, id)} className="mt-6">
        <Button variant="ghost" size="sm" className="text-red-600"><Trash2 className="h-4 w-4" /> Delete design</Button>
      </form>
    </>
  );
}
