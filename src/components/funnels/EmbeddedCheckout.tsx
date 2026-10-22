"use client";

import { useEffect, useRef, useState } from "react";

type StripeEmbedded = { mount: (el: HTMLElement) => void; destroy: () => void };
type StripeFactory = (pk: string) => { initEmbeddedCheckout: (o: { fetchClientSecret: () => Promise<string> }) => Promise<StripeEmbedded> };

/** Stripe Embedded Checkout: the payment form renders inside Pamela's page — no redirect. */
export function EmbeddedCheckout({ paymentId, publishableKey }: { paymentId: string; publishableKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let checkout: StripeEmbedded | null = null;
    let cancelled = false;
    const load = () =>
      new Promise<void>((resolve, reject) => {
        if ((window as unknown as { Stripe?: StripeFactory }).Stripe) return resolve();
        const script = document.createElement("script");
        script.src = "https://js.stripe.com/v3/";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Could not load the secure payment form."));
        document.head.appendChild(script);
      });
    load()
      .then(async () => {
        const stripe = (window as unknown as { Stripe: StripeFactory }).Stripe(publishableKey);
        checkout = await stripe.initEmbeddedCheckout({
          fetchClientSecret: async () => {
            const res = await fetch(`/api/public/pay/${paymentId}/session`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Payment unavailable");
            return data.clientSecret as string;
          },
        });
        if (cancelled) checkout.destroy();
        else if (ref.current) checkout.mount(ref.current);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
  }, [paymentId, publishableKey]);

  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  return <div ref={ref} className="min-h-96" />;
}
