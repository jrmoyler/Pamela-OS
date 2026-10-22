import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { PageHeader, Card, CardHeader, Badge, Button, Input, statusTone } from "@/components/ui";
import { TEMPLATES, renderDesignSvg } from "@/components/studio/designTemplates";
import { fileUrl } from "@/lib/storage";
import { timeAgo } from "@/lib/utils";
import { canvaConfigured } from "@/lib/modules/design";
import { createDesign } from "./actions";

export const metadata = { title: "Design studio" };

export default async function DesignStudio() {
  const db = await getDb();
  const designs = await db.select().from(schema.designs).orderBy(desc(schema.designs.updatedAt)).limit(100);
  const canva = await canvaConfigured();
  return (
    <>
      <PageHeader title="Design studio" subtitle={`Brand-locked templates — purple, serif, full name and phone always right.${canva ? " Canva is connected." : ""}`} />
      <Card className="mb-6">
        <CardHeader title="Start a design" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
          {TEMPLATES.map((t) => (
            <form key={t.key} action={createDesign} className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3">
              <div className="overflow-hidden rounded-lg" dangerouslySetInnerHTML={{ __html: renderDesignSvg(t.key, {}).replace("<svg ", '<svg style="width:100%;height:auto;display:block" ') }} />
              <p className="text-sm font-semibold">{t.name}</p>
              <p className="flex-1 text-xs text-zinc-500">{t.description}</p>
              <input type="hidden" name="templateKey" value={t.key} />
              <Input name="title" placeholder="Name (optional)" className="h-8 text-xs" />
              <Button size="sm">Use template</Button>
            </form>
          ))}
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {designs.map((d) => (
          <Link key={d.id} href={`/studio/design/${d.id}`}>
            <Card className="h-full overflow-hidden transition hover:border-brand/40">
              {d.exportFileId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(d.exportFileId)} alt={d.title} className="aspect-square w-full bg-zinc-100 object-contain" />
              ) : (
                <div className="aspect-square bg-zinc-100 p-3" dangerouslySetInnerHTML={{ __html: renderDesignSvg(d.templateKey, d.fields).replace("<svg ", '<svg style="width:100%;height:100%;display:block" ') }} />
              )}
              <div className="flex items-center justify-between gap-2 p-3">
                <div>
                  <p className="text-sm font-medium">{d.title}</p>
                  <p className="text-xs text-zinc-500">{timeAgo(d.updatedAt)}</p>
                </div>
                <Badge tone={statusTone(d.status)}>{d.status}</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
