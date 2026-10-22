"use server";

import { redirect } from "next/navigation";
import { createBooking, BookingError } from "@/lib/modules/booking";

export async function bookSlot(slug: string, form: FormData) {
  const slot = String(form.get("slot") || "");
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim();
  const phone = String(form.get("phone") || "").trim();
  const back = (msg: string) => redirect(`/book/${slug}?error=${encodeURIComponent(msg)}`);
  if (!slot) back("Please choose a time.");
  if (!name || (!email && !phone)) back("Please share your name and an email or phone number.");
  let dest = "";
  try {
    const r = await createBooking({ bookingType: slug, startsAt: new Date(slot), name, email: email || null, phone: phone || null, notes: String(form.get("notes") || "") || null, source: "web" });
    dest = r.payment ? `/pay/${r.payment.id}` : `/book/${slug}/confirmed?b=${r.booking.id}`;
  } catch (e) {
    back(e instanceof BookingError ? e.message : "Something went wrong. Please call (323) 943-ACUP.");
  }
  redirect(dest);
}
