import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { encrypt, decrypt } from "./crypto";
import { DEFAULT_BRAND_KIT, type BrandKit, BRAND } from "./brand";

/** Blackout window: no bookings, receptionist takes messages instead. */
export type BlackoutWindow = { days: number[]; start: string; end: string; label: string }; // days: 1=Mon..7=Sun

export type SettingsShape = {
  brandKit: BrandKit;
  blackouts: BlackoutWindow[];
  timezone: string;
  dictionary: { from: string; to: string }[];
  deliveryMode: "sandbox" | "live";
  aiRouting: { chat: string[]; drafting: string[]; agentic: string[]; summarize: string[] };
  receptionist: { greeting: string; urgentKeywords: string[]; transferNumber: string; enabled: boolean };
  emailFrom: { name: string; address: string };
};

export const DEFAULT_SETTINGS: SettingsShape = {
  brandKit: DEFAULT_BRAND_KIT,
  blackouts: [{ days: [1, 2, 3, 4, 5], start: "15:00", end: "17:30", label: "Weekday family time (3:00–5:30 PM)" }],
  timezone: BRAND.timezone,
  dictionary: [
    { from: "a cup of compassion", to: "A Cup of Compassion" },
    { from: "legal shield", to: "LegalShield" },
    { from: "pamela o s", to: "Pamela OS" },
  ],
  deliveryMode: "sandbox",
  aiRouting: {
    chat: ["hermes", "anthropic", "openai", "gemini", "meta"],
    drafting: ["hermes", "anthropic", "openai", "gemini", "meta"],
    agentic: ["meta", "hermes", "anthropic", "openai", "gemini"],
    summarize: ["anthropic", "openai", "gemini", "hermes", "meta"],
  },
  receptionist: {
    greeting: `Thank you for calling ${BRAND.name}. This is Pamela's assistant. How can I help you today?`,
    urgentKeywords: ["urgent", "emergency", "arrested", "court today", "hospital", "police", "evicted", "custody"],
    transferNumber: BRAND.urgentTransferE164,
    enabled: true,
  },
  emailFrom: { name: `Pamela | ${BRAND.name}`, address: "pamela@acupofcompassion.com" },
};

export async function getSetting<K extends keyof SettingsShape>(key: K): Promise<SettingsShape[K]> {
  const db = await getDb();
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  if (!row) return DEFAULT_SETTINGS[key];
  const def = DEFAULT_SETTINGS[key];
  if (def && typeof def === "object" && !Array.isArray(def)) return { ...def, ...(row.value as object) } as SettingsShape[K];
  return row.value as SettingsShape[K];
}

export async function setSetting<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) {
  const db = await getDb();
  await db
    .insert(schema.settings)
    .values({ key, value, encrypted: false })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}

export async function getAllSettings(): Promise<SettingsShape> {
  const entries = await Promise.all(
    (Object.keys(DEFAULT_SETTINGS) as (keyof SettingsShape)[]).map(async (k) => [k, await getSetting(k)] as const),
  );
  return Object.fromEntries(entries) as SettingsShape;
}

/* ───────────── Secrets (API keys) — env first, then encrypted settings ───────────── */

export const SECRET_DEFS = [
  { key: "HERMES_BASE_URL", label: "Hermes Agent base URL", group: "Operator (RJ)", secret: false, hint: "OpenAI-compatible endpoint on your VPS, e.g. https://rj.example.com/v1" },
  { key: "HERMES_API_KEY", label: "Hermes Agent API key", group: "Operator (RJ)", secret: true },
  { key: "HERMES_MODEL", label: "Hermes model name", group: "Operator (RJ)", secret: false, hint: "e.g. hermes-agent or NousResearch/Hermes-4-70B" },
  { key: "META_API_BASE_URL", label: "Meta Model API base URL", group: "Meta Muse", secret: false, hint: "Default https://api.llama.com/compat/v1" },
  { key: "META_API_KEY", label: "Meta Model API key", group: "Meta Muse", secret: true },
  { key: "META_MODEL", label: "Muse model (Spark / Wonder)", group: "Meta Muse", secret: false, hint: "e.g. muse-spark" },
  { key: "ANTHROPIC_API_KEY", label: "Claude API key", group: "AI models", secret: true },
  { key: "ANTHROPIC_MODEL", label: "Claude model", group: "AI models", secret: false, hint: "e.g. claude-sonnet-5-5" },
  { key: "OPENAI_API_KEY", label: "ChatGPT / OpenAI API key", group: "AI models", secret: true },
  { key: "OPENAI_MODEL", label: "OpenAI model", group: "AI models", secret: false },
  { key: "GEMINI_API_KEY", label: "Gemini API key", group: "AI models", secret: true },
  { key: "GEMINI_MODEL", label: "Gemini model", group: "AI models", secret: false },
  { key: "WHISPER_URL", label: "VPS Whisper endpoint", group: "AI models", secret: false, hint: "Optional self-hosted transcription (OpenAI-compatible /audio/transcriptions)" },
  { key: "TWILIO_ACCOUNT_SID", label: "Twilio Account SID", group: "Phone & SMS", secret: false },
  { key: "TWILIO_AUTH_TOKEN", label: "Twilio Auth Token", group: "Phone & SMS", secret: true },
  { key: "TWILIO_FROM_NUMBER", label: "Twilio number", group: "Phone & SMS", secret: false, hint: "+13239432287" },
  { key: "RESEND_API_KEY", label: "Resend API key (email)", group: "Email", secret: true },
  { key: "STRIPE_SECRET_KEY", label: "Stripe secret key", group: "Payments", secret: true },
  { key: "STRIPE_PUBLISHABLE_KEY", label: "Stripe publishable key", group: "Payments", secret: false },
  { key: "STRIPE_WEBHOOK_SECRET", label: "Stripe webhook secret", group: "Payments", secret: true },
  { key: "META_PAGE_ACCESS_TOKEN", label: "Facebook/Instagram page token", group: "Social", secret: true },
  { key: "META_PAGE_ID", label: "Facebook page ID", group: "Social", secret: false },
  { key: "META_IG_USER_ID", label: "Instagram business user ID", group: "Social", secret: false },
  { key: "META_VERIFY_TOKEN", label: "Webhook verify token", group: "Social", secret: true },
  { key: "META_APP_SECRET", label: "Meta app secret", group: "Social", secret: true },
  { key: "CANVA_ACCESS_TOKEN", label: "Canva Connect access token", group: "Studios", secret: true },
  { key: "CANVA_BRAND_TEMPLATE_ID", label: "Canva brand template ID", group: "Studios", secret: false },
  { key: "SUNO_API_BASE_URL", label: "Suno API base URL", group: "Studios", secret: false },
  { key: "SUNO_API_KEY", label: "Suno API key", group: "Studios", secret: true },
  { key: "ELEVENLABS_API_KEY", label: "ElevenLabs API key (voice)", group: "Studios", secret: true },
  { key: "CHATTERBOX_URL", label: "Chatterbox TTS endpoint (VPS)", group: "Studios", secret: false },
  { key: "WORKER_TOKEN", label: "VPS worker token", group: "Infrastructure", secret: true },
] as const;

export type SecretKey = (typeof SECRET_DEFS)[number]["key"];

export async function getSecret(name: SecretKey): Promise<string | undefined> {
  const env = process.env[name];
  if (env) return env;
  const db = await getDb();
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, `secret:${name}`));
  if (!row) return undefined;
  try {
    return decrypt(row.value as string);
  } catch {
    return undefined;
  }
}

export async function setSecret(name: SecretKey, value: string | null) {
  const db = await getDb();
  const key = `secret:${name}`;
  if (!value) {
    await db.delete(schema.settings).where(eq(schema.settings.key, key));
    return;
  }
  const enc = encrypt(value);
  await db
    .insert(schema.settings)
    .values({ key, value: enc, encrypted: true })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: enc, updatedAt: new Date() } });
}

/** Which secrets are configured, and where from — never returns values. */
export async function secretStatus(): Promise<Record<string, "env" | "stored" | null>> {
  const db = await getDb();
  const rows = await db.select({ key: schema.settings.key }).from(schema.settings);
  const stored = new Set(rows.map((r) => r.key));
  return Object.fromEntries(
    SECRET_DEFS.map((d) => [d.key, process.env[d.key] ? "env" : stored.has(`secret:${d.key}`) ? "stored" : null]),
  );
}
