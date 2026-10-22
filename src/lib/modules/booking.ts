import { and, eq, gte, inArray, lt, or } from "drizzle-orm";
import { getDb, schema } from "../db";
import { getSetting } from "../settings";
import { availableSlots, overlapsBlackout, formatSlot } from "../time";
import { findOrCreateContact, logActivity, contactName } from "../crm";
import { emit } from "../events";
import { createPaymentRequest } from "./payments";

export type BookingType = typeof schema.bookingTypes.$inferSelect;
export type Booking = typeof schema.bookings.$inferSelect;

const ACTIVE_STATUSES = ["confirmed", "pending_payment"];

export async function getBookingType(idOrSlug: string): Promise<BookingType | null> {
  const db = await getDb();
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const [row] = await db
    .select()
    .from(schema.bookingTypes)
    .where(isUuid ? or(eq(schema.bookingTypes.id, idOrSlug), eq(schema.bookingTypes.slug, idOrSlug)) : eq(schema.bookingTypes.slug, idOrSlug));
  return row ?? null;
}

/** Open slots for a booking type, respecting hours, buffer, existing bookings and blackout windows. */
export async function getSlots(idOrSlug: string | BookingType, days = 14, from = new Date()): Promise<Date[]> {
  const type = typeof idOrSlug === "string" ? await getBookingType(idOrSlug) : idOrSlug;
  if (!type || !type.active) return [];
  const db = await getDb();
  const tz = await getSetting("timezone");
  const blackouts = await getSetting("blackouts");
  const until = new Date(from.getTime() + (days + 1) * 86_400_000);
  const busy = await db
    .select({ startsAt: schema.bookings.startsAt, endsAt: schema.bookings.endsAt })
    .from(schema.bookings)
    .where(and(inArray(schema.bookings.status, ACTIVE_STATUSES), lt(schema.bookings.startsAt, until), gte(schema.bookings.endsAt, new Date(from.getTime() - 86_400_000))));
  return availableSlots({ hours: type.hours, durationMin: type.durationMin, bufferMin: type.bufferMin, from, days, busy, blackouts, tz });
}

/** Next N open slots across the default (or given) booking type — used by the receptionist. */
export async function nextSlots(n = 3, idOrSlug?: string): Promise<{ type: BookingType; slots: Date[] } | null> {
  const db = await getDb();
  let type: BookingType | null = idOrSlug ? await getBookingType(idOrSlug) : null;
  if (!type) {
    const types = await db.select().from(schema.bookingTypes).where(eq(schema.bookingTypes.active, true));
    type = types.find((t) => t.slug === "discovery") ?? types[0] ?? null;
  }
  if (!type) return null;
  const slots = await getSlots(type, 14);
  return { type, slots: slots.slice(0, n) };
}

export class BookingError extends Error {}

export async function createBooking(input: {
  bookingType: string; // id or slug
  startsAt: Date;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  contactId?: string | null;
  source?: "web" | "receptionist" | "rj" | "manual";
  notes?: string | null;
  skipAvailabilityCheck?: boolean;
}) {
  const type = await getBookingType(input.bookingType);
  if (!type) throw new BookingError("That booking type doesn't exist.");
  if (!type.active && input.source === "web") throw new BookingError("That booking type isn't available.");
  const tz = await getSetting("timezone");
  const blackouts = await getSetting("blackouts");
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new BookingError("Invalid time.");
  const endsAt = new Date(startsAt.getTime() + type.durationMin * 60_000);
  // Blackout is non-negotiable, even for manual bookings.
  if (overlapsBlackout(startsAt, endsAt, blackouts, tz)) throw new BookingError("That time falls in a blackout window (family time). Please choose another time.");
  if (!input.skipAvailabilityCheck) {
    const slots = await getSlots(type, 60, new Date(Date.now() - 60_000));
    if (!slots.some((s) => s.getTime() === startsAt.getTime())) throw new BookingError("That time is no longer available. Please pick another slot.");
  } else {
    const db0 = await getDb();
    const clash = await db0
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(and(inArray(schema.bookings.status, ACTIVE_STATUSES), lt(schema.bookings.startsAt, endsAt), gte(schema.bookings.endsAt, new Date(startsAt.getTime() + 1))));
    if (clash.length) throw new BookingError("That overlaps an existing booking.");
  }

  const db = await getDb();
  let contact: typeof schema.contacts.$inferSelect | null = null;
  if (input.contactId) {
    [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, input.contactId));
  }
  if (!contact && (input.email || input.phone || input.name)) {
    const res = await findOrCreateContact({ name: input.name, email: input.email, phone: input.phone, source: `booking:${type.slug}` });
    contact = res.contact;
    if (res.created) await emit("contact.created", { contactId: contact.id, source: "booking" }, "booking");
  }

  let payment: Awaited<ReturnType<typeof createPaymentRequest>> | null = null;
  if (type.priceCents > 0) {
    payment = await createPaymentRequest({ contactId: contact?.id ?? null, amountCents: type.priceCents, description: `${type.name} — ${formatSlot(startsAt, tz)}` });
  }

  const [booking] = await db
    .insert(schema.bookings)
    .values({
      bookingTypeId: type.id,
      contactId: contact?.id ?? null,
      title: contact ? `${type.name} — ${contactName(contact)}` : type.name,
      startsAt,
      endsAt,
      status: payment ? "pending_payment" : "confirmed",
      source: input.source ?? "web",
      notes: input.notes ?? null,
      paymentId: payment?.id ?? null,
    })
    .returning();

  const startsAtLocal = formatSlot(startsAt, tz);
  await logActivity({
    type: "booking",
    direction: "inbound",
    contactId: contact?.id,
    title: `Booked ${type.name} · ${startsAtLocal}`,
    body: input.notes ?? null,
    subjectType: "booking",
    subjectId: booking.id,
    meta: { source: booking.source, status: booking.status },
  });
  await emit(
    "booking.created",
    { bookingId: booking.id, contactId: contact?.id ?? null, startsAt: startsAt.toISOString(), startsAtLocal, source: booking.source, bookingType: type.name },
    "booking",
  );
  if (contact && input.source !== "manual") await emit("lead.captured", { contactId: contact.id, source: `booking (${type.name})` }, "booking");
  return { booking, contact, payment, type, startsAtLocal };
}

export async function cancelBooking(id: string, reason?: string) {
  const db = await getDb();
  const [b] = await db.update(schema.bookings).set({ status: "cancelled" }).where(eq(schema.bookings.id, id)).returning();
  if (!b) return null;
  await logActivity({ type: "booking", contactId: b.contactId, title: `Booking cancelled: ${b.title}`, body: reason ?? null, subjectType: "booking", subjectId: b.id });
  await emit("booking.cancelled", { bookingId: b.id, contactId: b.contactId }, "booking");
  return b;
}
