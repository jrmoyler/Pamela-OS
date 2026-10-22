import Link from "next/link";
import { and, asc, gte, inArray, eq } from "drizzle-orm";
import { CalendarDays, Moon, ExternalLink } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { contactName } from "@/lib/crm";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Textarea, Select, Field, EmptyState, statusTone } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";
import { saveBookingType, deleteBookingType, cancelBookingAction, manualBooking } from "./actions";

export const metadata = { title: "Booking" };

const DAYS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;
const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type BT = typeof schema.bookingTypes.$inferSelect;

function TypeForm({ t }: { t?: BT }) {
  return (
    <form action={saveBookingType.bind(null, t?.id ?? null)} className="grid gap-3 p-4 sm:grid-cols-2">
      <Field label="Name"><Input name="name" defaultValue={t?.name} required /></Field>
      <Field label="Link name" hint="Public link: /book/<link-name>"><Input name="slug" defaultValue={t?.slug} placeholder="discovery" /></Field>
      <Field label="Description" className="sm:col-span-2"><Textarea name="description" defaultValue={t?.description ?? ""} className="min-h-16" /></Field>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <Field label="Minutes"><Input name="durationMin" type="number" defaultValue={t?.durationMin ?? 30} /></Field>
        <Field label="Buffer (min)"><Input name="bufferMin" type="number" defaultValue={t?.bufferMin ?? 10} /></Field>
        <Field label="Price ($)"><Input name="price" type="number" step="0.01" defaultValue={t ? (t.priceCents / 100).toString() : "0"} /></Field>
      </div>
      <Field label="Location" className="sm:col-span-2"><Input name="location" defaultValue={t?.location ?? "Phone call"} /></Field>
      <div className="sm:col-span-2">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Weekly hours</p>
        <div className="grid gap-1.5">
          {DAYS.map(([k, label]) => {
            const r = t?.hours?.[k]?.[0];
            return (
              <div key={k} className="flex items-center gap-2 text-sm">
                <label className="flex w-16 items-center gap-1.5">
                  <input type="checkbox" name={`${k}_on`} defaultChecked={t ? !!r : !["sat", "sun"].includes(k)} className="accent-brand" /> {label}
                </label>
                <input type="time" name={`${k}_start`} defaultValue={r?.start ?? "09:00"} className="h-8 rounded border border-zinc-300 px-2" />
                <span>–</span>
                <input type="time" name={`${k}_end`} defaultValue={r?.end ?? "17:00"} className="h-8 rounded border border-zinc-300 px-2" />
              </div>
            );
          })}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={t?.active ?? true} className="accent-brand" /> Accepting bookings
      </label>
      <div className="sm:col-span-2"><Button>{t ? "Save changes" : "Create booking type"}</Button></div>
    </form>
  );
}

export default async function BookingAdmin({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string; error?: string; ok?: string }> }) {
  const { edit, new: isNew, error, ok } = await searchParams;
  const db = await getDb();
  const tz = await getSetting("timezone");
  const blackouts = await getSetting("blackouts");
  const types = await db.select().from(schema.bookingTypes).orderBy(asc(schema.bookingTypes.name));
  const upcoming = await db
    .select({ b: schema.bookings, c: schema.contacts })
    .from(schema.bookings)
    .leftJoin(schema.contacts, eq(schema.bookings.contactId, schema.contacts.id))
    .where(and(gte(schema.bookings.endsAt, new Date()), inArray(schema.bookings.status, ["confirmed", "pending_payment"])))
    .orderBy(asc(schema.bookings.startsAt))
    .limit(100);
  const contacts = await db.select().from(schema.contacts).orderBy(asc(schema.contacts.firstName)).limit(500);
  const editing = types.find((t) => t.id === edit);

  return (
    <>
      <PageHeader
        title="Booking"
        subtitle="Booking types, your calendar and the public booking pages. Blackout windows are always respected."
        actions={
          <>
            <Link href="/book"><Button variant="outline"><ExternalLink className="h-4 w-4" /> View public page</Button></Link>
            <Link href="/booking?new=1"><Button>New booking type</Button></Link>
          </>
        }
      />
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {ok && <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Booking saved.</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Upcoming" subtitle={`${upcoming.length} on the calendar`} />
            {upcoming.length === 0 ? (
              <div className="p-4"><EmptyState icon={<CalendarDays className="h-8 w-8" />} title="Nothing booked yet">Share /book or let the receptionist book callers.</EmptyState></div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {upcoming.map(({ b, c }) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="w-44 font-medium text-brand">{fmtDate(b.startsAt, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{b.title}</p>
                      {c && <Link href={`/contacts/${c.id}`} className="text-xs text-zinc-500 hover:text-brand">{contactName(c)} · {c.phone ?? c.email}</Link>}
                    </div>
                    <Badge>{b.source}</Badge>
                    <Badge tone={statusTone(b.status)}>{b.status.replace("_", " ")}</Badge>
                    {b.paymentId && <Link href={`/pay/${b.paymentId}`} className="text-xs text-brand underline">payment page</Link>}
                    <form action={cancelBookingAction.bind(null, b.id)}><Button size="sm" variant="ghost" className="text-red-600">Cancel</Button></form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {(isNew || editing) && (
            <Card>
              <CardHeader title={editing ? `Edit “${editing.name}”` : "New booking type"} />
              <TypeForm t={editing} />
            </Card>
          )}
          <Card>
            <CardHeader title="Booking types" />
            <ul className="divide-y divide-zinc-100">
              {types.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.name} {!t.active && <Badge tone="amber">paused</Badge>}</p>
                    <p className="text-xs text-zinc-500">
                      /book/{t.slug} · {t.durationMin} min · {t.priceCents ? money(t.priceCents) : "free"} · {t.location}
                    </p>
                  </div>
                  <Link href={`/book/${t.slug}`}><Button size="sm" variant="ghost">Preview</Button></Link>
                  <Link href={`/booking?edit=${t.id}`}><Button size="sm" variant="outline">Edit</Button></Link>
                  <form action={deleteBookingType.bind(null, t.id)}><Button size="sm" variant="ghost" className="text-red-600">Delete</Button></form>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Blackout windows" subtitle="No bookings and no calls put through (except urgent transfers)." />
            <ul className="space-y-2 p-4 text-sm">
              {blackouts.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Moon className="mt-0.5 h-4 w-4 text-brand" />
                  <span>
                    <span className="font-medium">{b.label}</span>
                    <br />
                    <span className="text-zinc-500">{b.days.map((d) => DAY_NAMES[d]).join(", ")} · {b.start}–{b.end}</span>
                  </span>
                </li>
              ))}
              <li className="text-xs text-zinc-500">Edit in <Link href="/settings" className="text-brand underline">Settings</Link>.</li>
            </ul>
          </Card>
          <Card>
            <CardHeader title="Add a booking" subtitle="For bookings you take yourself." />
            <form action={manualBooking} className="space-y-3 p-4">
              <Field label="Type">
                <Select name="bookingTypeId">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Date"><Input name="date" type="date" required /></Field>
                <Field label="Time"><Input name="time" type="time" required /></Field>
              </div>
              <Field label="Existing contact">
                <Select name="contactId" defaultValue="">
                  <option value="">— new person —</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
                </Select>
              </Field>
              <Field label="Or name"><Input name="name" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Email"><Input name="email" type="email" /></Field>
                <Field label="Phone"><Input name="phone" type="tel" /></Field>
              </div>
              <Field label="Notes"><Textarea name="notes" className="min-h-16" /></Field>
              <Button className="w-full">Book it</Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
