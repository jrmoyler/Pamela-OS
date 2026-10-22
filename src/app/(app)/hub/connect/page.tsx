import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { appUrl } from "@/lib/outbound";
import { CLIENT_LABELS, SCOPE_LABELS, type AgentClient, type Scope } from "@/lib/hub/keys";
import { PageHeader, Card, CardHeader, Badge, Button } from "@/components/ui";
import { KeyMaker } from "@/components/hub/KeyMaker";
import { timeAgo } from "@/lib/utils";
import { createKey, revokeKey } from "../actions";

export const metadata = { title: "Connect agents" };

export default async function ConnectPage() {
  await requireSession();
  const db = await getDb();
  const keys = await db.select().from(schema.agentKeys).orderBy(desc(schema.agentKeys.createdAt));
  const base = appUrl();

  return (
    <>
      <PageHeader
        title="Connect agents"
        subtitle="Give Claude, ChatGPT, Meta Muse and Hermes their own key so they can push files and information into Pamela OS, and read what you allow."
        actions={<Link href="/hub"><Button variant="outline">Back to Command Center</Button></Link>}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="New agent key" subtitle="One key per agent, so you can see who sent what and switch any of them off." />
          <KeyMaker create={createKey} />
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="How it works" />
            <div className="space-y-2 p-4 text-sm text-zinc-700">
              <p>Pamela OS is an <b>MCP server</b> at <code className="break-all text-xs">{base}/api/mcp</code>. Agents that speak MCP (Claude, ChatGPT, Hermes) get tools to push files and notes, look up contacts, tasks, calendar and files, add tasks and draft messages.</p>
              <p>Anything an agent drafts to another person waits in <Link href="/approvals" className="text-brand underline">Approvals</Link>. Requests to use your computer wait in the <Link href="/hub#computer" className="text-brand underline">Command Center</Link>.</p>
              <p>Apps that can&apos;t speak MCP (Meta Muse actions, phone shortcuts, Zapier) can post to <code className="break-all text-xs">{base}/api/inbox</code> with the key.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Keys" subtitle={`${keys.filter((k) => !k.revokedAt).length} active`} />
            {keys.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">No keys yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {keys.map((k) => (
                  <li key={k.id} className="space-y-1 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-brand-ink">{k.name}</span>
                      <Badge tone="brand">{CLIENT_LABELS[k.client as AgentClient] ?? k.client}</Badge>
                      {k.revokedAt && <Badge tone="red">switched off</Badge>}
                      <code className="ml-auto text-xs text-zinc-400">{k.tokenPrefix}…</code>
                    </div>
                    <p className="text-xs text-zinc-500">{k.scopes.map((s) => SCOPE_LABELS[s as Scope] ?? s).join(" · ")}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">{k.lastUsedAt ? `Last used ${timeAgo(k.lastUsedAt)}` : "Never used"}</span>
                      {!k.revokedAt && (
                        <form action={revokeKey.bind(null, k.id)}>
                          <Button size="sm" variant="ghost">Switch off</Button>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
