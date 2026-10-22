import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { contactName } from "@/lib/crm";
import { getSetting } from "@/lib/settings";
import { stripeConfigured } from "@/lib/modules/payments";
import { PageHeader, Card, CardHeader, Badge, Input, Button, Field, Select, Textarea, statusTone } from "@/components/ui";
import { FunnelTabs } from "@/components/funnels/FunnelTabs";
import { fmtDate, money } from "@/lib/utils";
import { requestPayment } from "../actions";

export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const db = await getDb();
  const [payments, contacts, tz, ready] = await Promise.all([
    db
      .select({ p: schema.payments, c: schema.contacts })
      .from(schema.payments)
      .leftJoin(schema.contacts, eq(schema.payments.contactId, schema.contacts.id))
      .orderBy(desc(schema.payments.createdAt))
      .limit(200),
    db.select().from(schema.contacts).orderBy(schema.contacts.firstName),
    getSetting("timezone"),
    stripeConfigured(),
  ]);
  const paid = payments.filter(({ p }) => p.status === "paid").reduce((s, { p }) => s + p.amountCents, 0);

  return (
    <>
      <PageHeader title="Pages & Forms" subtitle={`${money(paid)} collected in Pamela OS`} />
      <FunnelTabs active="/funnels/payments" />
      {!ready && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Stripe isn&apos;t connected yet — payment pages will ask people to call. Add your Stripe keys in{" "}
          <Link href="/settings" className="font-semibold underline">
            Settings
          </Link>
          .
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2">For</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {payments.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                    No payments yet.
                  </td>
                </tr>
              )}
              {payments.map(({ p, c }) => (
                <tr key={p.id}>
                  <td className="px-4 py-2">
                    <Link href={`/pay/${p.id}`} className="font-medium hover:text-brand">
                      {p.description}
                    </Link>
                    <p className="text-xs text-zinc-500">{fmtDate(p.paidAt ?? p.createdAt, tz)}</p>
                  </td>
                  <td className="px-4 py-2">{c ? <Link href={`/contacts/${c.id}`}>{contactName(c)}</Link> : <span className="text-zinc-400">Web checkout</span>}</td>
                  <td className="px-4 py-2 text-right font-semibold">{money(p.amountCents, p.currency)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <CardHeader title="Request a payment" subtitle="Creates a secure in-app payment page and drafts the message — sent only after you approve." />
          <form action={requestPayment} className="space-y-3 p-4">
            <Field label="Who">
              <Select name="contactId" required>
                <option value="">Choose a contact…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {contactName(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount ($)">
              <Input name="amount" type="number" step="0.01" min="0.5" required />
            </Field>
            <Field label="For">
              <Input name="description" placeholder="Speaking deposit — Spring Gala" required />
            </Field>
            <Field label="Send by">
              <Select name="channel">
                <option value="email">Email</option>
                <option value="sms">Text</option>
              </Select>
            </Field>
            <Field label="Message (optional)" hint="The payment link is added automatically.">
              <Textarea name="message" className="min-h-16" />
            </Field>
            <Button className="w-full">Draft payment request</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
