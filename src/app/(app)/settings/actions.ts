"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { setSetting, getSetting, setSecret, SECRET_DEFS, type SecretKey, type BlackoutWindow } from "@/lib/settings";
import { requireSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import type { ProviderId } from "@/lib/ai";

export async function saveSecrets(form: FormData) {
  for (const d of SECRET_DEFS) {
    const v = form.get(d.key);
    if (v == null) continue;
    const s = String(v).trim();
    if (s === "") continue; // blank = unchanged
    await setSecret(d.key as SecretKey, s === "-" ? null : s);
  }
  revalidatePath("/settings");
}

export async function clearSecret(key: string) {
  await setSecret(key as SecretKey, null);
  revalidatePath("/settings");
}

export async function setDeliveryMode(mode: "sandbox" | "live") {
  await setSetting("deliveryMode", mode);
  revalidatePath("/", "layout");
}

export async function saveBrand(form: FormData) {
  const kit = await getSetting("brandKit");
  await setSetting("brandKit", {
    ...kit, // name, color and phone stay locked
    tagline: String(form.get("tagline") ?? kit.tagline),
    signature: String(form.get("signature") ?? kit.signature),
    voiceNotes: String(form.get("voiceNotes") ?? kit.voiceNotes),
    bannedPhrases: String(form.get("bannedPhrases") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  });
  await setSetting("emailFrom", { name: String(form.get("fromName") || ""), address: String(form.get("fromAddress") || "") });
  revalidatePath("/settings");
}

export async function saveSchedule(form: FormData) {
  const rows: BlackoutWindow[] = [];
  const labels = form.getAll("label").map(String);
  labels.forEach((label, i) => {
    const start = String(form.getAll("start")[i] ?? "");
    const end = String(form.getAll("end")[i] ?? "");
    const days = String(form.getAll("days")[i] ?? "")
      .split(",")
      .map((d) => Number(d.trim()))
      .filter((d) => d >= 1 && d <= 7);
    if (start && end && days.length) rows.push({ label: label || "Protected time", start, end, days });
  });
  await setSetting("blackouts", rows);
  const tz = String(form.get("timezone") || "");
  if (tz) await setSetting("timezone", tz);
  revalidatePath("/settings");
}

export async function saveDictionary(form: FormData) {
  const entries = String(form.get("dictionary") ?? "")
    .split("\n")
    .map((l) => l.split("=>").map((s) => s.trim()))
    .filter((p) => p.length === 2 && p[0] && p[1])
    .map(([from, to]) => ({ from, to }));
  await setSetting("dictionary", entries);
  revalidatePath("/settings");
}

export async function saveRouting(form: FormData) {
  const parse = (k: string) =>
    String(form.get(k) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is ProviderId => ["hermes", "meta", "anthropic", "openai", "gemini"].includes(s));
  await setSetting("aiRouting", { chat: parse("chat"), drafting: parse("drafting"), agentic: parse("agentic"), summarize: parse("summarize") });
  revalidatePath("/settings");
}

export async function changePassword(form: FormData) {
  const session = await requireSession();
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.uid));
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (!user || !verifyPassword(current, user.passwordHash)) throw new Error("Current password is incorrect.");
  if (next.length < 10) throw new Error("New password must be at least 10 characters.");
  await db.update(schema.users).set({ passwordHash: hashPassword(next) }).where(eq(schema.users.id, user.id));
  revalidatePath("/settings");
}
