import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { Clock } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a time with Pamela" };

export default async function BookIndex() {
  const db = await getDb();
  const types = await db.select().from(schema.bookingTypes).where(eq(schema.bookingTypes.active, true)).orderBy(asc(schema.bookingTypes.durationMin));
  return (
    <>
      <h1 className="font-serif text-3xl font-bold text-brand">Book a time with Pamela</h1>
      <p className="mt-2 text-zinc-600">Choose the conversation that fits. All times are Pacific.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {types.map((t) => (
          <Link key={t.id} href={`/book/${t.slug}`} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-brand">
            <h2 className="font-serif text-xl font-bold text-brand-ink">{t.name}</h2>
            {t.description && <p className="mt-1 text-sm text-zinc-600">{t.description}</p>}
            <p className="mt-3 flex items-center gap-1.5 text-sm text-brand">
              <Clock className="h-4 w-4" /> {t.durationMin} minutes · {t.priceCents ? money(t.priceCents) : "Complimentary"}
            </p>
          </Link>
        ))}
        {types.length === 0 && <p className="text-zinc-600">Online booking is paused right now. Please call (323) 943-ACUP.</p>}
      </div>
    </>
  );
}
