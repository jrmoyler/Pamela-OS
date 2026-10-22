import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { getSecret } from "../settings";
import { appUrl, stripeRequest } from "../outbound";
import { logActivity } from "../crm";
import { emit } from "../events";
import { BRAND } from "../brand";

export type Payment = typeof schema.payments.$inferSelect;

/** Creates a pending payment. The customer pays on the in-app /pay/[id] page. */
export async function createPaymentRequest(p: { contactId: string | null; amountCents: number; description: string }) {
  const db = await getDb();
  const [payment] = await db
    .insert(schema.payments)
    .values({ contactId: p.contactId, amountCents: p.amountCents, description: p.description })
    .returning();
  return payment;
}

export async function getPayment(id: string): Promise<Payment | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, id));
  return p ?? null;
}

export async function stripeConfigured() {
  return !!(await getSecret("STRIPE_SECRET_KEY")) && !!(await getSecret("STRIPE_PUBLISHABLE_KEY"));
}

/** Stripe Embedded Checkout session — the customer pays without leaving Pamela's page. */
export async function createEmbeddedCheckout(paymentId: string): Promise<{ clientSecret: string }> {
  const payment = await getPayment(paymentId);
  if (!payment) throw new Error("Payment not found");
  if (payment.status === "paid") throw new Error("Already paid");
  const db = await getDb();
  let email: string | undefined;
  if (payment.contactId) {
    const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, payment.contactId));
    email = c?.email ?? undefined;
  }
  const session = await stripeRequest("checkout/sessions", {
    ui_mode: "embedded",
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": payment.currency,
    "line_items[0][price_data][unit_amount]": String(payment.amountCents),
    "line_items[0][price_data][product_data][name]": payment.description,
    "line_items[0][price_data][product_data][description]": BRAND.name,
    "metadata[paymentId]": payment.id,
    "payment_intent_data[metadata][paymentId]": payment.id,
    client_reference_id: payment.id,
    return_url: `${appUrl()}/pay/${payment.id}?session_id={CHECKOUT_SESSION_ID}`,
    ...(email ? { customer_email: email } : {}),
  });
  await db.update(schema.payments).set({ stripeSessionId: session.id }).where(eq(schema.payments.id, payment.id));
  return { clientSecret: session.client_secret };
}

/** Confirms a session on return (covers setups where the webhook isn't wired yet). */
export async function confirmCheckoutSession(paymentId: string, sessionId: string) {
  const payment = await getPayment(paymentId);
  if (!payment || payment.status === "paid") return payment;
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return payment;
  const session = await stripeRequest(`checkout/sessions/${sessionId}`, {}, "GET");
  if (session.client_reference_id === paymentId && session.payment_status === "paid") {
    await markPaymentPaid(paymentId, { sessionId: session.id, paymentIntentId: session.payment_intent ?? null });
  }
  return getPayment(paymentId);
}

/** Idempotent: timeline, event bus and any booking waiting on this payment. */
export async function markPaymentPaid(paymentId: string, ref: { sessionId?: string | null; paymentIntentId?: string | null }) {
  const db = await getDb();
  const [updated] = await db
    .update(schema.payments)
    .set({ status: "paid", paidAt: new Date(), stripeSessionId: ref.sessionId ?? undefined, stripePaymentIntentId: ref.paymentIntentId ?? undefined })
    .where(eq(schema.payments.id, paymentId))
    .returning();
  if (!updated) return null;
  // Only the first transition to paid writes history (pending → paid).
  if (await hasPaidActivity(paymentId)) return updated;
  await logActivity({
    type: "purchase",
    direction: "inbound",
    contactId: updated.contactId,
    title: `Payment received: $${(updated.amountCents / 100).toFixed(2)}`,
    body: updated.description,
    subjectType: "payment",
    subjectId: updated.id,
    meta: { paid: true, sessionId: ref.sessionId ?? null },
  });
  const bookings = await db
    .update(schema.bookings)
    .set({ status: "confirmed" })
    .where(eq(schema.bookings.paymentId, updated.id))
    .returning();
  await emit("payment.succeeded", { paymentId: updated.id, contactId: updated.contactId, amountCents: updated.amountCents, bookingIds: bookings.map((b) => b.id) }, "payments");
  return updated;
}

async function hasPaidActivity(paymentId: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.activities).where(eq(schema.activities.subjectId, paymentId));
  return rows.some((r) => r.type === "purchase" && (r.meta as { paid?: boolean }).paid);
}

/** Verifies a Stripe-Signature header (t=…,v1=…) against the raw body. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  const sigs = header
    .split(",")
    .filter((kv) => kv.startsWith("v1="))
    .map((kv) => kv.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
