import Link from "next/link";
import { desc } from "drizzle-orm";
import { LayoutTemplate } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { PAGE_TEMPLATES } from "@/lib/modules/funnels";
import { PageHeader, Card, CardHeader, Badge, EmptyState, Input, Button, Field, Select } from "@/components/ui";
import { FunnelTabs } from "@/components/funnels/FunnelTabs";
import { timeAgo } from "@/lib/utils";
import { createPage } from "./actions";

export const metadata = { title: "Pages & Forms" };

export default async function FunnelsPage() {
  const db = await getDb();
  const pages = await db.select().from(schema.pages).orderBy(desc(schema.pages.updatedAt));
  return (
    <>
      <PageHeader title="Pages & Forms" subtitle="Landing pages, lead magnets and sales pages — built and hosted inside Pamela OS." />
      <FunnelTabs active="/funnels" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {pages.length === 0 ? (
            <EmptyState icon={<LayoutTemplate className="h-8 w-8" />} title="No pages yet">
              Start from a template on the right. Pages go live only after you approve them.
            </EmptyState>
          ) : (
            <Card className="divide-y divide-zinc-100">
              {pages.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/funnels/pages/${p.id}`} className="font-medium text-brand-ink hover:text-brand">
                      {p.title}
                    </Link>
                    <p className="text-xs text-zinc-500">
                      /p/{p.slug} · {p.kind.replace("_", " ")} · edited {timeAgo(p.updatedAt)}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-500">{p.views} views</span>
                  <Badge tone={p.published ? "green" : "default"}>{p.published ? "Live" : "Draft"}</Badge>
                  {p.published && (
                    <Link href={`/p/${p.slug}`} className="text-xs font-medium text-brand hover:underline">
                      View
                    </Link>
                  )}
                </div>
              ))}
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="New page" />
          <form action={createPage} className="space-y-3 p-4">
            <Field label="Title">
              <Input name="title" placeholder="Free guide: Talking to kids about hard things" required />
            </Field>
            <Field label="Web address" hint="Leave blank to use the title.">
              <Input name="slug" placeholder="free-guide" />
            </Field>
            <Field label="Start from">
              <Select name="template" defaultValue="lead">
                {Object.entries(PAGE_TEMPLATES).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button className="w-full">Create page</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
