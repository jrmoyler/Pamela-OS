import { notFound } from "next/navigation";
import { Clock, MapPin } from "lucide-react";
import { getBookingType, getSlots } from "@/lib/modules/booking";
import { getSetting } from "@/lib/settings";
import { formatInTz, tzLabel } from "@/lib/time";
import { money } from "@/lib/utils";
import { bookSlot } from "../actions";

export const dynamic = "force-dynamic";


export default async function BookType({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const { error } = await searchParams;
  const type = await getBookingType(slug);
  if (!type || !type.active) notFound();
  const tz = await getSetting("timezone");
  const slots = await getSlots(type, 21);
  const byDay = new Map<string, Date[]>();
  for (const s of slots) {
    const key = formatInTz(s, tz, { weekday: "long", month: "long", day: "numeric" });
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  return (
    <>
      <h1 className="font-serif text-3xl font-bold text-brand">{type.name}</h1>
      {type.description && <p className="mt-2 font-serif text-zinc-700">{type.description}</p>}
      <p className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-600">
        <span className="flex items-center gap-1"><Clock className="h-4 w-4 text-brand" /> {type.durationMin} min</span>
        <span className="flex items-center gap-1"><MapPin className="h-4 w-4 text-brand" /> {type.location}</span>
        <span>{type.priceCents ? money(type.priceCents) : "Complimentary"}</span>
      </p>
      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      <form action={bookSlot.bind(null, type.slug)} className="mt-6 grid gap-6 md:grid-cols-5">
        <div className="space-y-4 md:col-span-3">
          <h2 className="font-semibold text-brand-ink">Choose a time <span className="text-xs font-normal text-zinc-500">({tzLabel(tz)})</span></h2>
          {byDay.size === 0 && <p className="text-sm text-zinc-600">No open times in the next three weeks. Please call (323) 943-ACUP.</p>}
          {[...byDay.entries()].map(([day, ds]) => (
            <fieldset key={day} className="rounded-xl border border-zinc-200 bg-white p-3">
              <legend className="px-1 font-serif text-sm font-bold text-brand-ink">{day}</legend>
              <div className="flex flex-wrap gap-2">
                {ds.map((s) => (
                  <label key={s.toISOString()} className="cursor-pointer rounded-lg border border-brand/30 px-3 py-1.5 text-sm text-brand has-[:checked]:bg-brand has-[:checked]:text-white">
                    <input type="radio" name="slot" value={s.toISOString()} className="sr-only" required />
                    {formatInTz(s, tz, { hour: "numeric", minute: "2-digit" })}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="space-y-3 md:col-span-2">
          <h2 className="font-semibold text-brand-ink">Your details</h2>
          <input name="name" required placeholder="Full name" aria-label="Full name" autoComplete="name" className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm" />
          <input name="email" type="email" placeholder="Email" aria-label="Email" autoComplete="email" className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm" />
          <input name="phone" type="tel" placeholder="Phone" aria-label="Phone" autoComplete="tel" className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm" />
          <textarea name="notes" placeholder="Anything Pamela should know?" aria-label="Notes" className="min-h-24 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm" />
          <button className="h-11 w-full rounded-lg bg-brand font-semibold text-white hover:bg-brand-dark">{type.priceCents ? `Continue to payment · ${money(type.priceCents)}` : "Confirm booking"}</button>
        </div>
      </form>
    </>
  );
}
