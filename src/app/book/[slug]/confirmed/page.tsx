import Link from "next/link";
import { eq } from "drizzle-orm";
import { CheckCircle2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { formatSlot } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function Confirmed({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const { b } = await searchParams;
  const db = await getDb();
  const [booking] = b && /^[0-9a-f-]{36}$/i.test(b) ? await db.select().from(schema.bookings).where(eq(schema.bookings.id, b)) : [];
  const tz = await getSetting("timezone");
  return (
    <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
      <CheckCircle2 className="mx-auto h-12 w-12 text-brand" />
      <h1 className="mt-4 font-serif text-3xl font-bold text-brand">You&apos;re booked</h1>
      {booking && <p className="mt-2 font-serif text-lg text-zinc-700">{formatSlot(booking.startsAt, tz)} (Pacific)</p>}
      <p className="mt-4 text-zinc-600">Pamela is looking forward to it. If anything changes, call (323) 943-ACUP.</p>
      <Link href="/book" className="mt-6 inline-block text-sm text-brand underline">Book another time</Link>
    </div>
  );
}
