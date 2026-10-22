import Link from "next/link";
import { headers } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { PhoneCall } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting, getSecret } from "@/lib/settings";
import { contactName } from "@/lib/crm";
import { appUrl } from "@/lib/outbound";
import { BRAND } from "@/lib/brand";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Textarea, Field, EmptyState, statusTone } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { TestConsole } from "@/components/receptionist/TestConsole";
import { saveReceptionistSettings } from "./actions";

export const metadata = { title: "Receptionist" };

export default async function ReceptionistPage({ searchParams }: { searchParams: Promise<{ call?: string }> }) {
  const { call: openId } = await searchParams;
  const db = await getDb();
  const tz = await getSetting("timezone");
  const settings = await getSetting("receptionist");
  const twilioReady = !!(await getSecret("TWILIO_ACCOUNT_SID")) && !!(await getSecret("TWILIO_AUTH_TOKEN"));
  const calls = await db
    .select({ call: schema.calls, c: schema.contacts })
    .from(schema.calls)
    .leftJoin(schema.contacts, eq(schema.calls.contactId, schema.contacts.id))
    .orderBy(desc(schema.calls.startedAt))
    .limit(100);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const base = process.env.APP_URL ? appUrl() : host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : appUrl();

  return (
    <>
      <PageHeader
        title="AI receptionist"
        subtitle={`Answers ${BRAND.phoneDisplay}, screens callers, books around your blackout window and puts urgent calls through to ${BRAND.urgentTransferDisplay}.`}
        actions={<Badge tone={settings.enabled ? "green" : "amber"}>{settings.enabled ? "Answering" : "Message-only mode"}</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="Call log" subtitle={`${calls.length} recent calls`} />
            {calls.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={<PhoneCall className="h-8 w-8" />} title="No calls yet">Place a test call on the right to see how callers are handled.</EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {calls.map(({ call, c }) => (
                  <li key={call.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/receptionist?call=${call.id}`} className="font-medium text-brand-ink hover:text-brand">
                        {c ? contactName(c) : call.fromNumber ?? "Unknown caller"}
                      </Link>
                      {call.urgency === "urgent" && <Badge tone="red">urgent</Badge>}
                      {call.disposition && <Badge tone={statusTone(call.disposition)}>{call.disposition}</Badge>}
                      {!call.endedAt && <Badge tone="amber">live</Badge>}
                      {call.callSid?.startsWith("TEST-") && <Badge>test</Badge>}
                      <span className="ml-auto text-xs text-zinc-400">{fmtDate(call.startedAt, tz)}</span>
                    </div>
                    {call.summary && <p className="mt-1 text-sm text-zinc-600">{call.summary}</p>}
                    {c && <Link href={`/contacts/${c.id}`} className="text-xs text-brand underline">Open contact</Link>}
                    {openId === call.id && (
                      <div className="mt-2 space-y-1 rounded-lg bg-zinc-50 p-3 text-sm">
                        {call.turns.map((t, i) => (
                          <p key={i}>
                            <span className="mr-1 text-xs font-semibold uppercase text-zinc-500">{t.role}:</span>
                            {t.text}
                          </p>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Test call" subtitle="Talk to the receptionist right here — same engine as the phone line." />
            <TestConsole />
          </Card>
          <Card>
            <CardHeader title="Receptionist settings" />
            <form action={saveReceptionistSettings} className="space-y-3 p-4">
              <Field label="Greeting"><Textarea name="greeting" defaultValue={settings.greeting} className="min-h-20" /></Field>
              <Field label="Urgent keywords" hint="Comma separated. Any match transfers the call immediately.">
                <Textarea name="urgentKeywords" defaultValue={settings.urgentKeywords.join(", ")} className="min-h-16" />
              </Field>
              <Field label="Urgent transfer number"><Input name="transferNumber" defaultValue={settings.transferNumber} /></Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="accent-brand" /> Screen and book calls (off = take messages only)
              </label>
              <Button className="w-full">Save</Button>
            </form>
          </Card>
          <Card>
            <CardHeader title="Phone line connection" subtitle={twilioReady ? "Twilio keys found — signatures are verified." : "Add Twilio keys in Settings to verify webhook signatures."} />
            <div className="space-y-2 p-4 text-sm">
              <p className="text-zinc-600">In Twilio, set these on the {BRAND.phoneDisplay} number:</p>
              <Field label="A call comes in (POST)"><Input readOnly value={`${base}/api/webhooks/twilio/voice`} /></Field>
              <Field label="Call status changes (POST)"><Input readOnly value={`${base}/api/webhooks/twilio/status`} /></Field>
              <Field label="A message comes in (POST)"><Input readOnly value={`${base}/api/webhooks/twilio/sms`} /></Field>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
