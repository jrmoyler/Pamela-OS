import Link from "next/link";
import { desc } from "drizzle-orm";
import { FileText } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { PageHeader, Card, CardHeader, Badge, EmptyState, Input, Button, Field } from "@/components/ui";
import { FunnelTabs } from "@/components/funnels/FunnelTabs";
import { createForm } from "../actions";

export const metadata = { title: "Forms" };

export default async function FormsPage() {
  const db = await getDb();
  const forms = await db.select().from(schema.forms).orderBy(desc(schema.forms.createdAt));
  return (
    <>
      <PageHeader title="Pages & Forms" subtitle="Every submission becomes a contact, lands in a pipeline and can start a sequence." />
      <FunnelTabs active="/funnels/forms" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {forms.length === 0 ? (
            <EmptyState icon={<FileText className="h-8 w-8" />} title="No forms yet">
              Create a form, then drop it on any page with the Form block.
            </EmptyState>
          ) : (
            <Card className="divide-y divide-zinc-100">
              {forms.map((f) => (
                <Link key={f.id} href={`/funnels/forms/${f.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-brand-soft/40">
                  <div className="flex-1">
                    <p className="font-medium text-brand-ink">{f.name}</p>
                    <p className="text-xs text-zinc-500">{f.fields.length} fields{f.leadMagnetFileId ? " · lead magnet" : ""}</p>
                  </div>
                  {f.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                  <Badge tone="brand">{f.submissions} submissions</Badge>
                </Link>
              ))}
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="New form" />
          <form action={createForm} className="space-y-3 p-4">
            <Field label="Name">
              <Input name="name" placeholder="Free guide sign-up" required />
            </Field>
            <Button className="w-full">Create form</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
