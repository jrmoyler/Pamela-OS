"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { WeeklyHours } from "@/lib/db/schema";
import { createBooking, cancelBooking, BookingError } from "@/lib/modules/booking";
import { getSetting } from "@/lib/settings";
import { zonedToUtc } from "@/lib/time";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function parseHours(form: FormData): WeeklyHours {
  const hours: WeeklyHours = {};
  for (const d of DAYS) {
    if (form.get(`${d}_on`) !== "on") continue;
    const start = String(form.get(`${d}_start`) || "09:00");
    const end = String(form.get(`${d}_end`) || "17:00");
    if (start < end) hours[d] = [{ start, end }];
  }
  return hours;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "booking";

export async function saveBookingType(id: string | null, form: FormData) {
  const db = await getDb();
  const values = {
    name: String(form.get("name") || "Appointment"),
    slug: slugify(String(form.get("slug") || form.get("name") || "")),
    description: String(form.get("description") || "") || null,
    durationMin: Math.max(5, Number(form.get("durationMin") || 30)),
    bufferMin: Math.max(0, Number(form.get("bufferMin") || 0)),
    priceCents: Math.round(Number(form.get("price") || 0) * 100),
    location: String(form.get("location") || "Phone call"),
    active: form.get("active") === "on",
    hours: parseHours(form),
  };
  try {
    if (id) await db.update(schema.bookingTypes).set(values).where(eq(schema.bookingTypes.id, id));
    else await db.insert(schema.bookingTypes).values(values);
  } catch {
    redirect(`/booking?error=${encodeURIComponent("That link name is already used by another booking type.")}`);
  }
  revalidatePath("/booking");
  redirect("/booking");
}

export async function deleteBookingType(id: string) {
  const db = await getDb();
  await db.delete(schema.bookingTypes).where(eq(schema.bookingTypes.id, id));
  revalidatePath("/booking");
}

export async function cancelBookingAction(id: string) {
  await cancelBooking(id, "Cancelled by Pamela");
  revalidatePath("/booking");
}

export async function manualBooking(form: FormData) {
  const tz = await getSetting("timezone");
  const date = String(form.get("date") || "");
  const time = String(form.get("time") || "");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || Number.isNaN(hh)) redirect(`/booking?error=${encodeURIComponent("Pick a date and time.")}`);
  const startsAt = zonedToUtc(y, m, d, hh, mm || 0, tz);
  let err: string | null = null;
  try {
    await createBooking({
      bookingType: String(form.get("bookingTypeId")),
      startsAt,
      contactId: String(form.get("contactId") || "") || null,
      name: String(form.get("name") || "") || null,
      email: String(form.get("email") || "") || null,
      phone: String(form.get("phone") || "") || null,
      notes: String(form.get("notes") || "") || null,
      source: "manual",
      skipAvailabilityCheck: true,
    });
  } catch (e) {
    err = e instanceof BookingError ? e.message : "Could not create the booking.";
  }
  revalidatePath("/booking");
  redirect(err ? `/booking?error=${encodeURIComponent(err)}` : "/booking?ok=1");
}
