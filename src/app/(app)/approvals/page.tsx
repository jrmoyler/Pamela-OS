import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { CheckCircle2, ShieldAlert, Sparkles, X, RotateCcw, Clock } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { KIND_LABELS, type ApprovalKind } from "@/lib/approvals";
import { contactName } from "@/lib/crm";
import { PageHeader, Card, Badge, Button, Input, Textarea, Tabs, EmptyState, statusTone } from "@/components/ui";
import { fmtDate, timeAgo } from "@/lib/utils";
import { fileUrl } from "@/lib/storage";
import { approveItem, rejectItem, saveItem, fixBrand, retryItem } from "./actions";

export const metadata = { title: "Approvals" };

const EDITABLE: Partial<Record<ApprovalKind, string[]>> = {
  email: ["to", "subject", "body"],
  sms: ["to", "body"],
  dm: ["message"],
  charge: ["to", "message"],
  clip_post: ["caption"],
  design_publish: ["caption"],
  song_release: ["caption"],
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "pending" } = await searchParams;
  const db = await getDb();
  const tz = await getSetting("timezone");
  const mode = await getSetting("deliveryMode");
  const statuses = tab === "pending" ? ["pending"] : tab === "scheduled" ? ["approved"] : tab === "failed" ? ["failed"] : ["sent", "rejected"];
  const rows = await db
    .select({ a: schema.approvals, c: schema.contacts })
    .from(schema.approvals)
    .leftJoin(schema.contacts, eq(schema.approvals.contactId, schema.contacts.id))
    .where(inArray(schema.approvals.status, statuses))
    .orderBy(desc(schema.approvals.createdAt))
    .limit(200);
  const all = await db.select({ status: schema.approvals.status }).from(schema.approvals);
  const n = (s: string[]) => all.filter((x) => s.includes(x.status)).length;

  // Media previews for posts that reference stored files.
  const postIds = rows.filter((r) => r.a.kind === "social_post").map((r) => String(r.a.payload.socialPostId));
  const posts = postIds.length ? await db.select().from(schema.socialPosts).where(inArray(schema.socialPosts.id, postIds)) : [];

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle={
          <>
            Every email, text, DM, post, payment request, release and voice message waits here for your yes.
            {mode === "sandbox" && <span className="ml-1 font-medium text-amber-700">Sandbox delivery is on — approved items are recorded, not delivered.</span>}
          </>
        }
      />
      <Tabs
        active={`/approvals?tab=${tab}`}
        tabs={[
          { href: "/approvals?tab=pending", label: "Waiting", count: n(["pending"]) },
          { href: "/approvals?tab=scheduled", label: "Scheduled", count: n(["approved"]) },
          { href: "/approvals?tab=failed", label: "Failed", count: n(["failed"]) },
          { href: "/approvals?tab=history", label: "History" },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title={tab === "pending" ? "All clear" : "Nothing here"}>
          {tab === "pending" ? "When RJ, automations, sequences or the receptionist draft something, it lands here first." : null}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {rows.map(({ a, c }) => {
            const fields = EDITABLE[a.kind as ApprovalKind] ?? [];
            const p = a.payload as Record<string, string | string[]>;
            const post = posts.find((x) => x.id === p.socialPostId);
            const pending = a.status === "pending";
            return (
              <Card key={a.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3">
                  <Badge tone="brand">{KIND_LABELS[a.kind as ApprovalKind] ?? a.kind}</Badge>
                  <p className="flex-1 font-medium">{a.title}</p>
                  <span className="text-xs text-zinc-500">
                    by {a.createdBy} · {timeAgo(a.createdAt)}
                  </span>
                  {!pending && <Badge tone={statusTone(a.status)}>{a.status}</Badge>}
                </div>
                <div className="space-y-3 p-4">
                  {c && (
                    <p className="text-sm text-zinc-500">
                      For <Link href={`/contacts/${c.id}`} className="font-medium text-brand hover:underline">{contactName(c)}</Link>
                    </p>
                  )}
                  {a.summary && <p className="text-sm text-zinc-600">{a.summary}</p>}
                  {a.brandIssues.length > 0 && (
                    <div className="flex flex-wrap items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <ul className="flex-1 list-disc pl-4">{a.brandIssues.map((i) => <li key={i}>{i}</li>)}</ul>
                      {pending && (
                        <form action={fixBrand.bind(null, a.id)}>
                          <Button size="sm" variant="outline"><Sparkles className="h-3.5 w-3.5" /> Apply brand fixes</Button>
                        </form>
                      )}
                    </div>
                  )}
                  {a.scheduledFor && (
                    <p className="flex items-center gap-1 text-xs text-zinc-500"><Clock className="h-3.5 w-3.5" /> Scheduled for {fmtDate(a.scheduledFor, tz)}</p>
                  )}
                  {post && (
                    <div className="rounded-lg border border-zinc-200 p-3 text-sm">
                      <p className="mb-1 text-xs uppercase text-zinc-500">{post.platform}</p>
                      {post.mediaFileId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fileUrl(post.mediaFileId)} alt="" className="mb-2 max-h-64 rounded" />
                      )}
                      <p className="whitespace-pre-wrap">{post.caption}</p>
                    </div>
                  )}
                  {pending ? (
                    <form action={approveItem.bind(null, a.id)} className="space-y-2">
                      {fields.map((f) =>
                        f === "body" || f === "message" || f === "caption" ? (
                          <Textarea key={f} name={f} defaultValue={String(p[f] ?? "")} className={f === "body" && a.kind === "email" ? "min-h-48 font-serif" : "min-h-24"} />
                        ) : (
                          <Input key={f} name={f} defaultValue={String(p[f] ?? "")} aria-label={f} />
                        ),
                      )}
                      {!fields.length && <pre className="max-h-48 overflow-auto rounded-lg bg-zinc-50 p-3 text-xs">{JSON.stringify(a.payload, null, 2)}</pre>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button><CheckCircle2 className="h-4 w-4" /> Approve & send</Button>
                        <Button formAction={saveItem.bind(null, a.id)} variant="outline">Save edits</Button>
                        <Button formAction={rejectItem.bind(null, a.id)} variant="ghost" className="text-red-600"><X className="h-4 w-4" /> Reject</Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      {fields.map((f) => p[f] ? <p key={f} className="whitespace-pre-wrap text-sm"><span className="text-xs uppercase text-zinc-400">{f}: </span>{String(p[f])}</p> : null)}
                      {a.error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{a.error}</p>}
                      {a.result && (a.result as { simulated?: boolean }).simulated && <Badge tone="amber">recorded in sandbox — not delivered</Badge>}
                      {a.status === "failed" && (
                        <form action={retryItem.bind(null, a.id)}>
                          <Button size="sm" variant="outline"><RotateCcw className="h-3.5 w-3.5" /> Put back in queue</Button>
                        </form>
                      )}
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
