import Link from "next/link";
import { count, desc, eq, inArray, isNull } from "drizzle-orm";
import { Inbox, MonitorSmartphone, Plug, FileText, Link2, StickyNote, Paperclip } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting, secretStatus, type SecretKey } from "@/lib/settings";
import { requireSession } from "@/lib/auth";
import { PROVIDER_LABELS, type ProviderId } from "@/lib/ai";
import { SOURCE_LABELS } from "@/lib/hub/inbox";
import { CLIENT_LABELS, type AgentClient } from "@/lib/hub/keys";
import { KIND_LABELS, type ComputerKind } from "@/lib/hub/computer";
import { contactName } from "@/lib/crm";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Select, Textarea, EmptyState, Stat, statusTone } from "@/components/ui";
import { AskModel } from "@/components/hub/AskModel";
import { fmtDate, timeAgo } from "@/lib/utils";
import {
  askModel,
  saveAnswerToInbox,
  queueComputerTask,
  approveTask,
  cancelTask,
  retryTask,
  setComputerMode,
  markInbox,
  inboxToTask,
  inboxToContact,
} from "./actions";

export const metadata = { title: "Command Center" };

type Service = { label: string; needs: SecretKey[]; href: string; group: string };

const SERVICES: Service[] = [
  { group: "AI", label: "Hermes Agent (RJ + her computer)", needs: ["HERMES_BASE_URL"], href: "/rj" },
  { group: "AI", label: "Meta Muse", needs: ["META_API_KEY"], href: "/rj" },
  { group: "AI", label: "Claude", needs: ["ANTHROPIC_API_KEY"], href: "/rj" },
  { group: "AI", label: "ChatGPT", needs: ["OPENAI_API_KEY"], href: "/rj" },
  { group: "AI", label: "Gemini", needs: ["GEMINI_API_KEY"], href: "/rj" },
  { group: "Reach", label: "Phone & texts (Twilio)", needs: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], href: "/receptionist" },
  { group: "Reach", label: "Email (Resend)", needs: ["RESEND_API_KEY"], href: "/campaigns" },
  { group: "Reach", label: "Instagram & Facebook", needs: ["META_PAGE_ACCESS_TOKEN"], href: "/social" },
  { group: "Reach", label: "Payments (Stripe)", needs: ["STRIPE_SECRET_KEY"], href: "/funnels/payments" },
  { group: "Studios", label: "Canva", needs: ["CANVA_ACCESS_TOKEN"], href: "/studio/design" },
  { group: "Studios", label: "Suno", needs: ["SUNO_API_KEY"], href: "/studio/music" },
  { group: "Studios", label: "ElevenLabs voice", needs: ["ELEVENLABS_API_KEY"], href: "/studio/voice" },
  { group: "Files", label: "Google Drive", needs: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"], href: "/library?tab=gdrive" },
  { group: "Files", label: "Dropbox", needs: ["DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_REFRESH_TOKEN"], href: "/library?tab=dropbox" },
];

const PROVIDER_SECRET: Record<ProviderId, SecretKey> = {
  hermes: "HERMES_BASE_URL",
  meta: "META_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const ITEM_ICON = { file: Paperclip, note: StickyNote, link: Link2 } as const;

export default async function HubPage({ searchParams }: { searchParams: Promise<{ inbox?: string }> }) {
  await requireSession();
  const { inbox: inboxView = "new" } = await searchParams;
  const db = await getDb();
  const tz = await getSetting("timezone");
  const mode = await getSetting("computerMode");
  const status = await secretStatus();

  const [items, tasks, keys, [{ value: newCount }], [{ value: fileCount }]] = await Promise.all([
    db
      .select({ i: schema.inboxItems, f: schema.files, c: schema.contacts })
      .from(schema.inboxItems)
      .leftJoin(schema.files, eq(schema.inboxItems.fileId, schema.files.id))
      .leftJoin(schema.contacts, eq(schema.inboxItems.contactId, schema.contacts.id))
      .where(inboxView === "all" ? undefined : eq(schema.inboxItems.status, "new"))
      .orderBy(desc(schema.inboxItems.createdAt))
      .limit(40),
    db.select().from(schema.computerTasks).orderBy(desc(schema.computerTasks.createdAt)).limit(15),
    db.select().from(schema.agentKeys).where(isNull(schema.agentKeys.revokedAt)).orderBy(desc(schema.agentKeys.lastUsedAt)),
    db.select({ value: count() }).from(schema.inboxItems).where(eq(schema.inboxItems.status, "new")),
    db.select({ value: count() }).from(schema.files),
  ]);
  const taskFileIds = [...new Set(tasks.flatMap((t) => t.fileIds))];
  const taskFiles = taskFileIds.length ? await db.select().from(schema.files).where(inArray(schema.files.id, taskFileIds)) : [];
  const fileName = new Map(taskFiles.map((f) => [f.id, f.name]));
  const activeTasks = tasks.filter((t) => ["awaiting_approval", "queued", "running"].includes(t.status)).length;
  const effectiveMode = mode === "auto" ? (status.HERMES_BASE_URL ? "push" : "pull") : mode;
  const providers = (Object.keys(PROVIDER_LABELS) as ProviderId[]).map((id) => ({ id, label: PROVIDER_LABELS[id], connected: !!status[PROVIDER_SECRET[id]] }));
  const groups = [...new Set(SERVICES.map((s) => s.group))];

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle="Every service in one place: ask any model, hand work to Hermes on your computer, and catch what Claude, ChatGPT, Meta Muse and your files send in."
        actions={
          <>
            <Link href="/library"><Button variant="outline"><FileText className="h-4 w-4" /> Library</Button></Link>
            <Link href="/hub/connect"><Button><Plug className="h-4 w-4" /> Connect agents</Button></Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New in inbox" value={newCount} href="/hub#inbox" />
        <Stat label="Computer tasks open" value={activeTasks} href="/hub#computer" />
        <Stat label="Agents connected" value={keys.length} href="/hub/connect" />
        <Stat label="Files in library" value={fileCount} href="/library" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card id="inbox">
            <CardHeader
              title="Inbox"
              subtitle="Files, notes and links pushed in by your agents and connected folders"
              action={
                <div className="flex gap-2 text-xs">
                  <Link href="/hub?inbox=new#inbox" className={inboxView !== "all" ? "font-semibold text-brand" : "text-zinc-500"}>New</Link>
                  <Link href="/hub?inbox=all#inbox" className={inboxView === "all" ? "font-semibold text-brand" : "text-zinc-500"}>All</Link>
                </div>
              }
            />
            {items.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={<Inbox className="h-8 w-8" />} title="Nothing new">
                  When Claude, ChatGPT, Meta Muse or Hermes push something, or a file lands in your Drive or Dropbox inbox folder, it shows up here. <Link href="/hub/connect" className="text-brand underline">Connect an agent</Link>.
                </EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {items.map(({ i, f, c }) => {
                  const Icon = ITEM_ICON[i.kind as keyof typeof ITEM_ICON] ?? StickyNote;
                  return (
                    <li key={i.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon className="h-4 w-4 text-brand" />
                        <span className="font-medium text-brand-ink">{i.title}</span>
                        <Badge tone="brand">{SOURCE_LABELS[i.source] ?? i.source}</Badge>
                        {i.status !== "new" && <Badge tone={i.status === "filed" ? "green" : "default"}>{i.status}</Badge>}
                        <span className="ml-auto text-xs text-zinc-400">{timeAgo(i.createdAt)}</span>
                      </div>
                      {i.body && <p className="line-clamp-4 whitespace-pre-wrap text-sm text-zinc-600">{i.body}</p>}
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {f && <a href={`/api/files/${f.id}`} target="_blank" className="text-brand underline">Open {f.name}</a>}
                        {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="break-all text-brand underline">{i.url}</a>}
                        {c && <Link href={`/contacts/${c.id}`} className="text-brand underline">{contactName(c)}</Link>}
                      </div>
                      {i.status === "new" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={inboxToTask.bind(null, i.id)}><Button size="sm" variant="soft">Make a task</Button></form>
                          <form action={inboxToContact.bind(null, i.id)} className="flex gap-1">
                            <Input name="contact" placeholder="File to person…" className="h-8 w-40" aria-label="Contact name" />
                            <Button size="sm" variant="outline">File</Button>
                          </form>
                          <form action={markInbox.bind(null, i.id, "filed")}><Button size="sm" variant="ghost">Done</Button></form>
                          <form action={markInbox.bind(null, i.id, "dismissed")}><Button size="sm" variant="ghost">Dismiss</Button></form>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card id="computer">
            <CardHeader
              title="Your computer (Hermes)"
              subtitle={
                effectiveMode === "push"
                  ? "Tasks go straight to the Hermes API. Files it makes come back to your Library."
                  : "Hermes picks tasks up over MCP from wherever it runs (your laptop). Files it makes come back to your Library."
              }
              action={
                <form className="flex items-center gap-1">
                  {(["auto", "push", "pull"] as const).map((m) => (
                    <Button key={m} size="sm" variant={mode === m ? "default" : "ghost"} formAction={setComputerMode.bind(null, m)} title={{ auto: "Push when the Hermes API is connected, otherwise pull", push: "Pamela OS calls the Hermes API", pull: "Hermes checks in over MCP" }[m]}>
                      {m}
                    </Button>
                  ))}
                </form>
              }
            />
            <form action={queueComputerTask} className="space-y-2 border-b border-zinc-100 p-4">
              <Textarea name="instruction" required placeholder="e.g. “Download the October LegalShield commission statement from the portal and send it to my Library”" className="min-h-16" aria-label="What should Hermes do?" />
              <div className="flex gap-2">
                <Select name="kind" className="w-auto" aria-label="Kind">
                  <option value="browser">Browser</option>
                  <option value="computer">Computer</option>
                  <option value="files">Files</option>
                </Select>
                <Button><MonitorSmartphone className="h-4 w-4" /> Send to Hermes</Button>
              </div>
              <p className="text-xs text-zinc-500">Hermes never sends, posts or pays from your computer. Requests from RJ or another agent wait here for your yes.</p>
            </form>
            {tasks.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">No computer tasks yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {tasks.map((t) => (
                  <li key={t.id} className="space-y-1 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={t.status === "awaiting_approval" ? "amber" : statusTone(t.status)}>{t.status.replace("_", " ")}</Badge>
                      <Badge>{KIND_LABELS[t.kind as ComputerKind] ?? t.kind}</Badge>
                      {t.createdBy !== "user" && <Badge tone="blue">from {SOURCE_LABELS[t.createdBy] ?? t.createdBy}</Badge>}
                      <span className="ml-auto text-xs text-zinc-400">{fmtDate(t.createdAt, tz)}</span>
                    </div>
                    <p className="text-sm text-brand-ink">{t.instruction}</p>
                    {t.result && <p className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 text-sm text-zinc-700">{t.result}</p>}
                    {t.error && <p className="text-sm text-red-600">{t.error}</p>}
                    {t.fileIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 text-sm">
                        {t.fileIds.map((id) => (
                          <a key={id} href={`/api/files/${id}`} target="_blank" className="text-brand underline">{fileName.get(id) ?? "file"}</a>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      {t.status === "awaiting_approval" && <form action={approveTask.bind(null, t.id)}><Button size="sm">Approve</Button></form>}
                      {["awaiting_approval", "queued", "running"].includes(t.status) && <form action={cancelTask.bind(null, t.id)}><Button size="sm" variant="ghost">Cancel</Button></form>}
                      {["failed", "cancelled"].includes(t.status) && <form action={retryTask.bind(null, t.id)}><Button size="sm" variant="outline">Retry</Button></form>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Ask a model" subtitle="Talk to any of your models directly. RJ (in the sidebar) is the one that works across your data." />
            <AskModel providers={providers} ask={askModel} save={saveAnswerToInbox} />
          </Card>

          <Card>
            <CardHeader title="Services" subtitle="Everything Pamela OS controls. Connect keys in Settings." action={<Link href="/settings#connections" className="text-xs text-brand underline">Settings</Link>} />
            <div className="space-y-4 p-4">
              {groups.map((g) => (
                <div key={g}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{g}</p>
                  <ul className="space-y-1">
                    {SERVICES.filter((s) => s.group === g).map((s) => {
                      const on = s.needs.every((k) => status[k]);
                      return (
                        <li key={s.label} className="flex items-center justify-between gap-2 text-sm">
                          <Link href={s.href} className="text-brand-ink hover:text-brand">{s.label}</Link>
                          <Badge tone={on ? "green" : "default"}>{on ? "connected" : "not set"}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Agents with access" action={<Link href="/hub/connect" className="text-xs text-brand underline">Manage</Link>} />
            {keys.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">No agents connected yet. <Link href="/hub/connect" className="text-brand underline">Connect Claude, ChatGPT, Meta Muse or Hermes</Link> so they can push files and notes here.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {keys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span>
                      {k.name} <span className="text-xs text-zinc-400">· {CLIENT_LABELS[k.client as AgentClient] ?? k.client}</span>
                    </span>
                    <span className="text-xs text-zinc-400">{k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : "never used"}</span>
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
