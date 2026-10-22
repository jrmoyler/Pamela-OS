import { notFound } from "next/navigation";
import { CheckCircle2, Phone } from "lucide-react";
import { getPayment, stripeConfigured, confirmCheckoutSession } from "@/lib/modules/payments";
import { getSecret } from "@/lib/settings";
import { BRAND } from "@/lib/brand";
import { money } from "@/lib/utils";
import { EmbeddedCheckout } from "@/components/funnels/EmbeddedCheckout";
import { PublicFooter } from "@/components/funnels/Blocks";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: `Payment · ${BRAND.name}` } };

export default async function PayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ session_id?: string }> }) {
  const { id } = await params;
  const { session_id } = await searchParams;
  let payment = await getPayment(id);
  if (!payment) notFound();
  if (session_id && payment.status !== "paid") {
    payment = (await confirmCheckoutSession(id, session_id).catch(() => payment)) ?? payment;
  }
  const ready = await stripeConfigured();
  const pk = ready ? await getSecret("STRIPE_PUBLISHABLE_KEY") : undefined;

  return (
    <main className="flex min-h-screen flex-col bg-[#faf8fc]">
      <header className="bg-[#6a1b9a] px-6 py-8 text-center text-white">
        <p className="font-serif text-lg">{BRAND.name}</p>
      </header>
      <section className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <div className="mb-6 rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm uppercase tracking-wide text-zinc-500">{payment.description}</p>
          <p className="mt-1 text-4xl font-bold text-[#6a1b9a]">{money(payment.amountCents, payment.currency)}</p>
        </div>
        {payment.status === "paid" ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto h-12 w-12 text-[#6a1b9a]" />
            <h1 className="mt-3 font-serif text-2xl font-bold">Thank you — payment received</h1>
            <p className="mt-2 text-zinc-600">A receipt is on its way. With compassion, Pamela.</p>
          </div>
        ) : ready && pk && payment.status === "pending" ? (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <EmbeddedCheckout paymentId={payment.id} publishableKey={pk} />
          </div>
        ) : (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
            <h1 className="font-serif text-xl font-bold">Online payment isn&apos;t available right now</h1>
            <p className="mt-2 text-zinc-600">Please call or text and we&apos;ll take care of it personally.</p>
            <a href={`tel:${BRAND.phoneE164}`} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#6a1b9a] px-5 py-3 font-semibold text-white">
              <Phone className="h-4 w-4" /> {BRAND.phoneDisplay}
            </a>
          </div>
        )}
      </section>
      <PublicFooter />
    </main>
  );
}
