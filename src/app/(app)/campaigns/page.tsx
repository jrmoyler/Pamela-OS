import Link from "next/link";
import { desc } from "drizzle-orm";
import { Send } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { PageHeader, Card, CardHeader, Badge, EmptyState, Input, Button, Field, Select, Tabs, statusTone } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { getSetting } from "@/lib/settings";
import { createCampaign } from "./actions";

export const metadata = { title: "Email & Text" };

export default async function CampaignsPage() {
  const db = await getDb();
  const [rows, tz] = await Promise.all([db.select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)), getSetting("timezone")]);
  return (
    <>
      <PageHeader title="Email & Text" subtitle="Broadcasts and automated sequences. Every send waits for your approval." />
      <Tabs active="/campaigns" tabs={[{ href: "/campaigns", label: "Broadcasts" }, { href: "/campaigns/sequences", label: "Sequences" }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {rows.length === 0 ? (
            <EmptyState icon={<Send className="h-8 w-8" />} title="No broadcasts yet">
              Write one email or text to a group — by tag or relationship — and approve it to send.
            </EmptyState>
          ) : (
            <Card className="divide-y divide-zinc-100">
              {rows.map((c) => (
                <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-brand-soft/40">
                  <div className="flex-1">
                    <p className="font-medium text-brand-ink">{c.name}</p>
                    <p className="text-xs text-zinc-500">
                      {c.channel === "sms" ? "Text" : "Email"} · {c.audienceTags.length ? c.audienceTags.join(", ") : "everyone"}
                      {c.sentAt && ` · sent ${fmtDate(c.sentAt, tz)} to ${c.recipients}`}
                    </p>
                  </div>
                  <Badge tone={statusTone(c.status)}>{c.status.replace("_", " ")}</Badge>
                </Link>
              ))}
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="New broadcast" />
          <form action={createCampaign} className="space-y-3 p-4">
            <Field label="Name">
              <Input name="name" placeholder="Spring newsletter" required />
            </Field>
            <Field label="Channel">
              <Select name="channel">
                <option value="email">Email</option>
                <option value="sms">Text message</option>
              </Select>
            </Field>
            <Button className="w-full">Create</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
