import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { Bot, Plus, Trash2, Wrench } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { configuredProviders, PROVIDER_LABELS } from "@/lib/ai";
import { Card, Badge, Button } from "@/components/ui";
import { Composer } from "@/components/rj/Composer";
import { cn, miniMarkdown, timeAgo } from "@/lib/utils";
import { sendToRj, deleteThread } from "./actions";

export const metadata = { title: "RJ · Operator" };

const SUGGESTIONS = ["Brief me on today", "What's due this week?", "What's waiting for my approval?", "Find open slots this week", "Who do I need to follow up with?"];

export default async function RjPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const db = await getDb();
  const threads = await db.select().from(schema.rjThreads).orderBy(desc(schema.rjThreads.updatedAt)).limit(30);
  const active = t ? threads.find((x) => x.id === t) : undefined;
  const messages = active ? await db.select().from(schema.rjMessages).where(eq(schema.rjMessages.threadId, active.id)).orderBy(asc(schema.rjMessages.createdAt)) : [];
  const providers = await configuredProviders();

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="space-y-3">
        <Link href="/rj">
          <Button className="w-full"><Plus className="h-4 w-4" /> New conversation</Button>
        </Link>
        <Card className="p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Models connected</p>
          {providers.length ? (
            <div className="flex flex-wrap gap-1">{providers.map((p) => <Badge key={p} tone="brand">{PROVIDER_LABELS[p]}</Badge>)}</div>
          ) : (
            <p className="text-xs text-zinc-500">
              None yet — RJ runs in offline mode. <Link href="/settings#connections" className="text-brand underline">Connect Hermes or Meta Muse</Link>.
            </p>
          )}
        </Card>
        <nav className="space-y-1">
          {threads.map((th) => (
            <Link key={th.id} href={`/rj?t=${th.id}`} className={cn("block truncate rounded-lg px-3 py-2 text-sm hover:bg-brand-soft", th.id === t && "bg-brand-soft font-medium text-brand")}>
              {th.title}
              <span className="block text-xs text-zinc-400">{timeAgo(th.updatedAt)}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <section className="flex min-h-[70vh] flex-col">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white"><Bot className="h-5 w-5" /></span>
            <div>
              <h1 className="text-xl font-bold">RJ</h1>
              <p className="text-xs text-zinc-500">Your operator · drafts in your voice · nothing goes out without your yes</p>
            </div>
          </div>
          {active && (
            <form action={deleteThread.bind(null, active.id)}>
              <Button variant="ghost" size="sm"><Trash2 className="h-4 w-4" /></Button>
            </form>
          )}
        </div>
        <div className="flex-1 space-y-4">
          {messages.length === 0 && (
            <Card className="p-6 text-sm text-zinc-600">
              <p className="font-serif text-lg text-brand">Good to see you, Pamela.</p>
              <p className="mt-2">Ask me to triage your day, look someone up, find open times, draft follow-ups, move deals, or research anything already in Pamela OS.</p>
            </Card>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-white">{m.content}</div>
              </div>
            ) : (
              <div key={m.id} className="max-w-[90%]">
                {(m.toolCalls ?? []).length > 0 && (
                  <details className="mb-1 text-xs text-zinc-500">
                    <summary className="flex cursor-pointer items-center gap-1"><Wrench className="h-3 w-3" /> RJ used {m.toolCalls!.map((c) => c.name.replace(/_/g, " ")).join(", ")}</summary>
                    <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-zinc-50 p-2 text-[11px]">{JSON.stringify(m.toolCalls, null, 2)}</pre>
                  </details>
                )}
                <div className="md rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-4 py-3 text-sm" dangerouslySetInnerHTML={{ __html: miniMarkdown(m.content || "…") }} />
                <p className="mt-1 text-[11px] text-zinc-400">{m.provider} · {timeAgo(m.createdAt)}</p>
              </div>
            ),
          )}
        </div>
        <Composer action={sendToRj.bind(null, active?.id ?? null)} suggestions={messages.length === 0 ? SUGGESTIONS : undefined} />
      </section>
    </div>
  );
}
