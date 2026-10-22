import { desc } from "drizzle-orm";
import { MessageCircleHeart, Trash2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSecret } from "@/lib/settings";
import { appUrl } from "@/lib/outbound";
import { PageHeader, Card, CardHeader, Badge, Input, Textarea, Button, Field, Select, EmptyState } from "@/components/ui";
import { SocialTabs } from "@/components/social/SocialTabs";
import { saveTrigger, toggleTrigger, deleteTrigger, simulateComment } from "./actions";

export const metadata = { title: "Social & DMs" };

const SIM_MESSAGES: Record<string, string> = {
  matched: "Matched a trigger — the lead is in Contacts and the DM is waiting in Approvals.",
  nomatch: "No trigger matched that comment. It was logged to the social inbox.",
  dm: "DM logged and RJ drafted a reply in Approvals.",
  logged: "DM logged.",
};

function TriggerFields({ t, pages }: { t?: typeof schema.socialTriggers.$inferSelect; pages: { slug: string; title: string }[] }) {
  return (
    <>
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Keyword" hint="Matched as a whole word, any case.">
          <Input name="keyword" defaultValue={t?.keyword} placeholder="GUIDE" required />
        </Field>
        <Field label="Platform">
          <Select name="platform" defaultValue={t?.platform ?? "instagram"}>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
          </Select>
        </Field>
        <Field label="Name">
          <Input name="name" defaultValue={t?.name} placeholder="Free guide giveaway" />
        </Field>
        <Field label="Only on post ID (optional)">
          <Input name="postId" defaultValue={t?.postId ?? ""} />
        </Field>
      </div>
      <Field label="DM to send (after your approval)">
        <Textarea name="dmMessage" defaultValue={t?.dmMessage} placeholder="Thank you for commenting! Here's your free guide 💜" className="min-h-16" required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Link a page (lead magnet)">
          <Select name="pageSlug" defaultValue={t?.pageSlug ?? ""}>
            <option value="">No link</option>
            {pages.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tag the lead">
          <Input name="tags" defaultValue={t?.tags.join(", ")} placeholder="instagram, guide" />
        </Field>
      </div>
    </>
  );
}

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ sim?: string; edit?: string }> }) {
  const { sim, edit } = await searchParams;
  const db = await getDb();
  const [triggers, pages] = await Promise.all([
    db.select().from(schema.socialTriggers).orderBy(desc(schema.socialTriggers.createdAt)),
    db.select({ slug: schema.pages.slug, title: schema.pages.title }).from(schema.pages),
  ]);
  const connected = !!(await getSecret("META_PAGE_ACCESS_TOKEN"));

  return (
    <>
      <PageHeader title="Social & DMs" subtitle="Comment a keyword → become a lead → get a DM (after your approval)." />
      <SocialTabs active="/social" />
      {!connected && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Meta isn&apos;t connected yet. Point your Meta app&apos;s webhook at <code className="font-mono">{appUrl()}/api/webhooks/meta</code> and add the page token in Settings. Until then, use “Try it” below.
        </p>
      )}
      {sim && <p className="mb-4 rounded-lg bg-brand-soft p-3 text-sm font-medium text-brand">{SIM_MESSAGES[sim] ?? "Done."}</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {triggers.length === 0 ? (
            <EmptyState icon={<MessageCircleHeart className="h-8 w-8" />} title="No keyword triggers yet">
              Example: people comment “GUIDE” on a post and receive your free guide by DM.
            </EmptyState>
          ) : (
            triggers.map((t) =>
              edit === t.id ? (
                <Card key={t.id}>
                  <CardHeader title={`Edit “${t.keyword}”`} />
                  <form action={saveTrigger} className="space-y-3 p-4">
                    <TriggerFields t={t} pages={pages} />
                    <div className="flex gap-2">
                      <Button>Save</Button>
                      <a href="/social">
                        <Button type="button" variant="ghost">
                          Cancel
                        </Button>
                      </a>
                    </div>
                  </form>
                </Card>
              ) : (
                <Card key={t.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-brand-ink">
                      “{t.keyword}” <span className="text-sm font-normal text-zinc-500">on {t.platform}</span>
                    </p>
                    <p className="truncate text-sm text-zinc-500">{t.dmMessage}</p>
                    <p className="text-xs text-zinc-400">
                      {t.hits} leads{t.pageSlug && ` · links /p/${t.pageSlug}`}
                      {t.postId && ` · post ${t.postId}`}
                    </p>
                  </div>
                  <Badge tone={t.enabled ? "green" : "default"}>{t.enabled ? "On" : "Off"}</Badge>
                  <form action={toggleTrigger.bind(null, t.id, !t.enabled)}>
                    <Button size="sm" variant="outline">
                      {t.enabled ? "Pause" : "Turn on"}
                    </Button>
                  </form>
                  <a href={`/social?edit=${t.id}`}>
                    <Button size="sm" variant="ghost">
                      Edit
                    </Button>
                  </a>
                  <form action={deleteTrigger.bind(null, t.id)}>
                    <Button size="icon" variant="ghost" className="text-red-600" title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </form>
                </Card>
              ),
            )
          )}
          <Card>
            <CardHeader title="New keyword trigger" />
            <form action={saveTrigger} className="space-y-3 p-4">
              <TriggerFields pages={pages} />
              <Button>Create trigger</Button>
            </form>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="Try it" subtitle="Runs the real webhook handler with a pretend comment or DM." />
          <form action={simulateComment} className="space-y-3 p-4">
            <Field label="What">
              <Select name="kind">
                <option value="comment">Comment on a post</option>
                <option value="dm">Direct message</option>
              </Select>
            </Field>
            <Field label="Platform">
              <Select name="platform">
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
              </Select>
            </Field>
            <Field label="From (username)">
              <Input name="username" defaultValue="grace.j" />
            </Field>
            <Field label="Text">
              <Textarea name="text" defaultValue={triggers[0] ? `${triggers[0].keyword} please!` : "GUIDE please!"} className="min-h-16" />
            </Field>
            <Button variant="outline" className="w-full">
              Simulate
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
