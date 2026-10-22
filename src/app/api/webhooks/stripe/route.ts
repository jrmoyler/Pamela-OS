import { NextResponse } from "next/server";
import { getSecret } from "@/lib/settings";
import { markPaymentPaid, verifyStripeSignature } from "@/lib/modules/payments";

/** Stripe → Pamela OS. Only signed events are accepted. */
export async function POST(req: Request) {
  const secret = await getSecret("STRIPE_WEBHOOK_SECRET");
  if (!secret) return NextResponse.json({ error: "Stripe webhook secret not configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret)) return NextResponse.json({ error: "bad signature" }, { status: 400 });
  const event = JSON.parse(raw) as { type: string; data: { object: Record<string, unknown> } };
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object as { id: string; payment_status?: string; client_reference_id?: string; metadata?: { paymentId?: string }; payment_intent?: string };
    const paymentId = s.metadata?.paymentId ?? s.client_reference_id;
    if (paymentId && (s.payment_status === "paid" || event.type === "checkout.session.async_payment_succeeded")) {
      await markPaymentPaid(paymentId, { sessionId: s.id, paymentIntentId: s.payment_intent ?? null });
    }
  }
  return NextResponse.json({ received: true });
}
