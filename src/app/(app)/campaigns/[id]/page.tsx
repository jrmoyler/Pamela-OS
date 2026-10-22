import { notFound } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { Sparkles, Copy, Trash2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { RELATIONSHIP_TYPES } from "@/lib/crm";
import { lintBrand } from "@/lib/brand";
import { getSetting } from "@/lib/settings";
import { personalize } from "@/lib/approvals";
import { PageHeader, Card, CardHeader, Badge, Input, Textarea, Button, Field, statusTone } from "@/components/ui";
import { AudiencePicker } from "@/components/campaigns/AudiencePicker";
import { fmtDate } from "@/lib/utils";
import { saveCampaign, rjDraftCampaign, sendCampaign, deleteCampaign, duplicateCampaign, countAudience } from "../actions";

export const metadata = { title: "Broadcast" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  let [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  if (!c) notFound();
  // A rejected send returns the campaign to draft.
  if (c.status === "awaiting_approval") {
    const [pending] = await db
      .select({ id: schema.approvals.id })
      .from(schema.approvals)
      .where(and(eq(schema.approvals.subjectId, id), eq(schema.approvals.kind, "campaign_send"), eq(schema.approvals.status, "pending")));
    const [approved] = await db
      .select({ id: schema.approvals.id })
      .from(schema.approvals)
      .where(and(eq(schema.approvals.subjectId, id), eq(schema.approvals.kind, "campaign_send"), eq(schema.approvals.status, "approved")));
    if (!pending && !approved) [c] = await db.update(schema.campaigns).set({ status: "draft" }).where(eq(schema.campaigns.id, id)).returning();
  }
  const [kit, tz] = await Promise.all([getSetting("brandKit"), getSetting("timezone")]);
  const locked = c.status !== "draft";
  const issues = lintBrand(`${c.subject ?? ""}\n${c.body}`, kit);
  const sample = { firstName: "Grace", lastName: "Johnson", email: null, phone: null };

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={
          <span>
            <Badge tone={statusTone(c.status)}>{c.status.replace("_", " ")}</Badge>
            {c.sentAt && ` Sent ${fmtDate(c.sentAt, tz)} to ${c.recipients}`}
          </span>
        }
        actions={
          <>
            <form action={duplicateCampaign.bind(null, id)}>
              <Button variant="outline">
                <Copy className="h-4 w-4" /> Duplicate
              </Button>
            </form>
            {c.status === "awaiting_approval" && (
              <Link href="/approvals">
                <Button variant="soft">Waiting in Approvals</Button>
              </Link>
            )}
          </>
        }
      />
      <form id="campaign" action={saveCampaign.bind(null, id)} className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-3 p-4">
            <Field label="Internal name">
              <Input name="name" defaultValue={c.name} disabled={locked} />
            </Field>
            {c.channel === "email" && (
              <Field label="Subject">
                <Input name="subject" defaultValue={c.subject ?? ""} disabled={locked} />
              </Field>
            )}
            <Field label="Message" hint="Use {{first_name}} to personalize.">
              <Textarea name="body" defaultValue={c.body} disabled={locked} className="min-h-64 font-serif" />
            </Field>
            {issues.length > 0 && (
              <ul className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {issues.map((i) => (
                  <li key={i.code}>{i.message}</li>
                ))}
              </ul>
            )}
            {!locked && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline">Save draft</Button>
                <Button formAction={sendCampaign.bind(null, id)}>Send for approval</Button>
              </div>
            )}
          </Card>
          {c.body && (
            <Card>
              <CardHeader title="Preview" subtitle="As Grace would see it" />
              <div className="p-4">
                {c.channel === "email" && <p className="mb-2 font-semibold">{personalize(c.subject ?? "", sample)}</p>}
                <p className="whitespace-pre-wrap font-serif text-zinc-700">{personalize(c.body, sample)}</p>
              </div>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <AudiencePicker initial={c.audienceTags} relationshipTypes={RELATIONSHIP_TYPES} channel={c.channel} count={countAudience} disabled={locked} />
          </Card>
        </div>
      </form>
      {!locked && (
        <Card className="mt-6 lg:w-2/3">
          <CardHeader title="Ask RJ to draft it" subtitle="Replaces the message above with a draft in your voice." />
          <form action={rjDraftCampaign.bind(null, id)} className="space-y-2 p-4">
            <Textarea name="instructions" placeholder="e.g. Invite everyone to the free Saturday workshop on estate planning basics" className="min-h-16" />
            <Button variant="outline">
              <Sparkles className="h-4 w-4" /> Draft with RJ
            </Button>
          </form>
        </Card>
      )}
      <form action={deleteCampaign.bind(null, id)} className="mt-6">
        <Button variant="ghost" size="sm" className="text-red-600">
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </form>
    </>
  );
}
