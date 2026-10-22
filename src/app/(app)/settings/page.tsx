import { getAllSettings, secretStatus, SECRET_DEFS } from "@/lib/settings";
import { appUrl } from "@/lib/outbound";
import { BRAND } from "@/lib/brand";
import { PageHeader, Card, CardHeader, Button, Input, Textarea, Field, Badge } from "@/components/ui";
import { saveSecrets, setDeliveryMode, saveBrand, saveSchedule, saveDictionary, saveRouting, changePassword, clearSecret } from "./actions";

export const metadata = { title: "Settings" };

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function SettingsPage() {
  const s = await getAllSettings();
  const status = await secretStatus();
  const groups = [...new Set(SECRET_DEFS.map((d) => d.group))];
  const base = appUrl();
  const webhooks = [
    ["Twilio voice (A call comes in)", `${base}/api/webhooks/twilio/voice`],
    ["Twilio messaging (A message comes in)", `${base}/api/webhooks/twilio/sms`],
    ["Meta (Instagram/Facebook) webhook", `${base}/api/webhooks/meta`],
    ["Stripe webhook", `${base}/api/webhooks/stripe`],
    ["Scheduler (cron, Bearer CRON_SECRET)", `${base}/api/cron/tick`],
  ];

  return (
    <>
      <PageHeader title="Settings" subtitle="Connections, brand, schedule and how RJ routes work across your models." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="delivery" className="lg:col-span-2">
          <CardHeader title="Delivery mode" subtitle="Approvals always come first. This decides what happens after you approve." />
          <div className="flex flex-wrap items-center gap-3 p-4">
            <Badge tone={s.deliveryMode === "live" ? "green" : "amber"} className="px-3 py-1 text-sm">{s.deliveryMode === "live" ? "Live — approved items are delivered" : "Sandbox — approved items are recorded, not delivered"}</Badge>
            <form action={setDeliveryMode.bind(null, s.deliveryMode === "live" ? "sandbox" : "live")}>
              <Button variant={s.deliveryMode === "live" ? "outline" : "default"}>{s.deliveryMode === "live" ? "Switch to sandbox" : "Go live"}</Button>
            </form>
          </div>
        </Card>

        <Card id="connections" className="lg:col-span-2">
          <CardHeader title="Connections" subtitle="Keys are encrypted at rest (AES-256-GCM). Values set as server environment variables take precedence. Leave a field blank to keep it; enter - to clear." />
          <form action={saveSecrets} className="space-y-6 p-4">
            {groups.map((g) => (
              <div key={g}>
                <p className="mb-2 text-sm font-semibold text-brand">{g}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {SECRET_DEFS.filter((d) => d.group === g).map((d) => (
                    <Field key={d.key} label={d.label} hint={"hint" in d ? d.hint : undefined}>
                      <div className="flex gap-1">
                        <Input name={d.key} type={d.secret ? "password" : "text"} autoComplete="off" placeholder={status[d.key] ? (status[d.key] === "env" ? "set in environment" : "•••••• saved") : "not set"} />
                        {status[d.key] === "stored" && (
                          <Button formAction={clearSecret.bind(null, d.key)} variant="ghost" size="sm" title="Clear" aria-label={`Clear ${d.label}`}>×</Button>
                        )}
                      </div>
                    </Field>
                  ))}
                </div>
              </div>
            ))}
            <Button>Save connections</Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Brand kit" subtitle={`Locked: “${BRAND.name}”, ${BRAND.purple}, ${BRAND.phoneDisplay}`} />
          <form action={saveBrand} className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <span className="h-10 w-10 rounded-lg" style={{ background: BRAND.purple }} />
              <p className="font-serif text-lg text-brand">{s.brandKit.name}</p>
            </div>
            <Field label="Tagline"><Input name="tagline" defaultValue={s.brandKit.tagline} /></Field>
            <Field label="Email signature"><Textarea name="signature" defaultValue={s.brandKit.signature} className="font-serif" /></Field>
            <Field label="How Pamela sounds (used by every model)"><Textarea name="voiceNotes" defaultValue={s.brandKit.voiceNotes} /></Field>
            <Field label="Banned phrases (one per line)"><Textarea name="bannedPhrases" defaultValue={s.brandKit.bannedPhrases.join("\n")} className="min-h-16" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Email from name"><Input name="fromName" defaultValue={s.emailFrom.name} /></Field>
              <Field label="Email from address"><Input name="fromAddress" defaultValue={s.emailFrom.address} /></Field>
            </div>
            <Button>Save brand</Button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Protected time (blackouts)" subtitle="The receptionist and booking never schedule into these windows." />
            <form action={saveSchedule} className="space-y-3 p-4">
              {[...s.blackouts, { label: "", start: "", end: "", days: [] as number[] }].map((b, i) => (
                <div key={i} className="grid grid-cols-[1fr_90px_90px_110px] gap-2">
                  <Input name="label" defaultValue={b.label} placeholder="Label" aria-label="Label" />
                  <Input name="start" type="time" defaultValue={b.start} aria-label="Start time" />
                  <Input name="end" type="time" defaultValue={b.end} aria-label="End time" />
                  <Input name="days" defaultValue={b.days.join(",")} placeholder="1,2,3,4,5" aria-label="Days (1 = Monday … 7 = Sunday)" title={b.days.map((d) => DAY_NAMES[d]).join(" ")} />
                </div>
              ))}
              <p className="text-xs text-zinc-500">Days: 1 = Monday … 7 = Sunday. Clear a row to remove it.</p>
              <Field label="Time zone"><Input name="timezone" defaultValue={s.timezone} /></Field>
              <Button>Save schedule</Button>
            </form>
          </Card>
          <Card>
            <CardHeader title="Custom dictionary" subtitle="Voice input fixes these everywhere. One per line: heard => written" />
            <form action={saveDictionary} className="space-y-3 p-4">
              <Textarea name="dictionary" aria-label="Custom dictionary" defaultValue={s.dictionary.map((d) => `${d.from} => ${d.to}`).join("\n")} className="min-h-28 font-mono text-xs" />
              <Button>Save dictionary</Button>
            </form>
          </Card>
        </div>

        <Card>
          <CardHeader title="AI routing" subtitle="Order of models to try per kind of work: hermes, meta, anthropic, openai, gemini" />
          <form action={saveRouting} className="space-y-3 p-4">
            {(["chat", "drafting", "agentic", "summarize"] as const).map((k) => (
              <Field key={k} label={{ chat: "RJ conversation", drafting: "Drafting in her voice", agentic: "Multi-step agentic loops (Meta Muse)", summarize: "Summaries & transcripts" }[k]}>
                <Input name={k} defaultValue={s.aiRouting[k].join(", ")} />
              </Field>
            ))}
            <Button>Save routing</Button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Webhook URLs" subtitle="Paste these into Twilio, Meta and Stripe." />
            <ul className="space-y-2 p-4 text-sm">
              {webhooks.map(([label, url]) => (
                <li key={url}>
                  <p className="text-xs text-zinc-500">{label}</p>
                  <code className="block break-all rounded bg-zinc-50 px-2 py-1 text-xs">{url}</code>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Your data" subtitle="One database you control. Government IDs, passwords and card numbers are never stored." />
            <div className="p-4">
              <a href="/api/export"><Button variant="outline">Download full export (JSON)</Button></a>
            </div>
          </Card>
          <Card>
            <CardHeader title="Password" />
            <form action={changePassword} className="space-y-2 p-4">
              <Input name="current" type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" required />
              <Input name="next" type="password" autoComplete="new-password" placeholder="New password (10+ characters)" aria-label="New password" minLength={10} required />
              <Button variant="outline">Change password</Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
