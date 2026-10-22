import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { CallTurn } from "../db/schema";
import { getSetting } from "../settings";
import { isInBlackout, formatSlot, formatInTz, zonedParts, tzLabel } from "../time";
import { findOrCreateContact, logActivity, contactName, splitName } from "../crm";
import { emit } from "../events";
import { aiJson, aiText } from "../ai";
import { nextSlots, createBooking, BookingError } from "./booking";

/**
 * Transport-agnostic receptionist. Twilio webhooks and the in-app test console
 * both drive it: `startCall` → `handleTurn` (repeat) → `finalizeCall`.
 * State travels with the transport (Twilio action URL / console), the
 * conversation itself is persisted on the `calls` row.
 */

export type Stage = "screen" | "name" | "booking_offer" | "message" | "wrapup" | "done";
export type CallState = {
  stage: Stage;
  callerName?: string;
  reason?: string;
  intent?: "booking" | "message" | "info" | "urgent" | "spam";
  offered?: string[]; // ISO slots
  offeredType?: string; // booking type slug
  offerRound?: number;
  message?: string;
  bookingId?: string;
  silent?: number;
  turns?: number;
};

export type CallAction = { type: "continue" } | { type: "transfer"; to: string } | { type: "hangup" };
export type TurnResult = { callId: string; reply: string; state: CallState; action: CallAction };

type CallRow = typeof schema.calls.$inferSelect;

const SPAM = /\b(car warranty|extended warranty|lower your (interest|rate)|google (listing|business)|seo services|press one|press 1|final notice|student loan forgiveness|this is not a sales call)\b/i;
const BOOKING = /\b(book|booking|appointment|schedule|set up a (call|time|meeting)|consult|consultation|meet with|available|availability|speaking (engagement|event)|discovery call)\b/i;
const NAME = /\b(?:my name is|this is|i am|i'm|name's)\s+([a-z][a-z'’-]+(?:\s+[a-z][a-z'’-]+)?)/i;
const NOT_NAMES = new Set(["calling", "looking", "interested", "trying", "just", "here", "wondering", "not", "so", "very", "really", "a", "the", "with", "from", "hoping", "an", "calling", "in", "on", "about", "having", "going", "need", "needing", "worried", "scared", "sorry"]);
const DONE = /^(no|nope|nah|that'?s (it|all)|nothing( else)?|i'?m (good|fine|all set)|all set|bye|goodbye|thank you,? (that'?s|bye)|no,? thank)/i;
const NONE_OF = /\b(none|neither|no(ne)? of (those|them)|other times?|something else|later|different (day|time))\b/i;

async function llmEnabledClassify(utterance: string, keywords: string[]) {
  return aiJson<{ urgent: boolean; spam: boolean; intent: "booking" | "message" | "info"; callerName?: string | null; reason?: string | null }>(
    "chat",
    `You screen phone calls for Pamela (A Cup of Compassion; she is also a LegalShield associate). Classify the caller's words.
urgent = a real emergency or time-critical legal/family/medical situation (arrest, court today, hospital, eviction, custody, police) or any of: ${keywords.join(", ")}.
spam = robocall or cold sales pitch.
intent = "booking" if they want to schedule/meet/book, "info" if a quick question, otherwise "message".
callerName = the caller's name only if they said it. reason = one short phrase.
Return {"urgent": bool, "spam": bool, "intent": string, "callerName": string|null, "reason": string|null}.`,
    utterance,
    300,
  );
}

function heuristicName(utterance: string): string | undefined {
  const m = utterance.match(NAME);
  if (!m) return undefined;
  const words = m[1].split(/\s+/).filter((w) => !NOT_NAMES.has(w.toLowerCase()));
  if (!words.length) return undefined;
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export async function classify(utterance: string) {
  const settings = await getSetting("receptionist");
  const lower = utterance.toLowerCase();
  const keywordUrgent = settings.urgentKeywords.some((k) => k && lower.includes(k.toLowerCase()));
  const ai = await llmEnabledClassify(utterance, settings.urgentKeywords).catch(() => null);
  const name = (ai?.data.callerName || undefined) ?? heuristicName(utterance);
  return {
    urgent: keywordUrgent || !!ai?.data.urgent,
    spam: !keywordUrgent && (SPAM.test(utterance) || !!ai?.data.spam),
    intent: ai?.data.intent ?? (BOOKING.test(utterance) ? "booking" : "message"),
    callerName: name || heuristicName(utterance),
    reason: ai?.data.reason ?? undefined,
    provider: ai?.provider ?? "rules",
  } as const;
}

async function appendTurns(callId: string, turns: CallTurn[], patch: Partial<CallRow> = {}) {
  const db = await getDb();
  const [cur] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
  if (!cur) throw new Error("Call not found");
  const [row] = await db
    .update(schema.calls)
    .set({ ...patch, turns: [...cur.turns, ...turns] })
    .where(eq(schema.calls.id, callId))
    .returning();
  return row;
}

const say = (text: string): CallTurn => ({ role: "receptionist", text, at: new Date().toISOString() });
const heard = (text: string): CallTurn => ({ role: "caller", text, at: new Date().toISOString() });

export async function startCall(opts: { callSid?: string | null; from?: string | null; to?: string | null }): Promise<TurnResult> {
  const db = await getDb();
  const settings = await getSetting("receptionist");
  const tz = await getSetting("timezone");
  const blackouts = await getSetting("blackouts");

  if (opts.callSid) {
    const [existing] = await db.select().from(schema.calls).where(eq(schema.calls.callSid, opts.callSid));
    if (existing) {
      const reply = existing.turns.filter((t) => t.role === "receptionist").at(-1)?.text ?? settings.greeting;
      return { callId: existing.id, reply, state: { stage: "screen" }, action: { type: "continue" } };
    }
  }

  let contactId: string | null = null;
  let knownName: string | undefined;
  if (opts.from && /\d{7,}/.test(opts.from.replace(/\D/g, ""))) {
    const { contact, created } = await findOrCreateContact({ phone: opts.from, source: "receptionist" });
    contactId = contact.id;
    if (created) await emit("contact.created", { contactId, source: "receptionist" }, "receptionist");
    if (contact.firstName) knownName = contactName(contact);
  }

  let greeting = settings.greeting;
  if (knownName) greeting = greeting.replace(/How can I help you today\??/i, `Hi ${knownName.split(" ")[0]}, how can I help you today?`);
  if (!settings.enabled) greeting = `Thank you for calling A Cup of Compassion. Pamela can't take your call right now. Please tell me your name, your message, and the best way to reach you.`;
  else if (isInBlackout(new Date(), blackouts, tz)) greeting += " Pamela is with her family right now, but I can take a message or book you a time.";

  const [call] = await db
    .insert(schema.calls)
    .values({ callSid: opts.callSid ?? null, fromNumber: opts.from ?? null, toNumber: opts.to ?? null, contactId, turns: [say(greeting)] })
    .returning();
  const state: CallState = settings.enabled ? { stage: "screen", callerName: knownName, turns: 0 } : { stage: "message", callerName: knownName, turns: 0, intent: "message" };
  return { callId: call.id, reply: greeting, state, action: { type: "continue" } };
}

function parseChoice(utterance: string, offered: string[], tz: string): number {
  const u = utterance.toLowerCase();
  const ordinals: [RegExp, number][] = [
    [/\b(second|2nd|two|number two|middle)\b/, 1],
    [/\b(third|3rd|three|number three|last)\b/, 2],
    [/\b(first|1st|one|number one|earliest)\b/, 0],
  ];
  const dates = offered.map((iso) => new Date(iso));
  // Weekday / time mentions win over ordinals ("Tuesday at 10").
  const scores = dates.map((d) => {
    let s = 0;
    const wd = formatInTz(d, tz, { weekday: "long" }).toLowerCase();
    if (u.includes(wd)) s += 2;
    const p = zonedParts(d, tz);
    const h12 = ((p.hour + 11) % 12) + 1;
    const timeRe = new RegExp(`\\b${h12}(:${String(p.minute).padStart(2, "0")})?\\s*(am|pm|a\\.m\\.|p\\.m\\.|o'?clock)?\\b`);
    if (timeRe.test(u)) s += 2;
    if (/\btomorrow\b/.test(u) && formatInTz(d, tz, { dateStyle: "short" }) === formatInTz(new Date(Date.now() + 86_400_000), tz, { dateStyle: "short" })) s += 2;
    return s;
  });
  const best = Math.max(...scores, 0);
  if (best > 0) return scores.indexOf(best);
  for (const [re, idx] of ordinals) if (re.test(u) && idx < offered.length) return idx;
  if (/\b(yes|yeah|sure|works|perfect|great|ok(ay)?|that one)\b/.test(u) && offered.length === 1) return 0;
  return -1;
}

async function offerSlots(state: CallState, tz: string, after?: Date): Promise<{ reply: string; state: CallState }> {
  const r = await nextSlots(30, state.offeredType ?? (await matchBookingType(state.reason ?? "")));
  const slots = (r?.slots ?? []).filter((s) => !after || s > after).slice(0, 3);
  if (!r || !slots.length) {
    return {
      reply: "I don't have an opening I can confirm right now, so I'll have Pamela reach out personally to set a time. What's the best number or email for her to reach you?",
      state: { ...state, stage: "message", intent: "booking" },
    };
  }
  const list = slots.map((s) => formatSlot(s, tz));
  const spoken = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")}, or ${list.at(-1)}`;
  return {
    reply: `I can book you a ${r.type.name} with Pamela. I have ${spoken}, ${tzLabel(tz)}. Which works best?`,
    state: { ...state, stage: "booking_offer", intent: "booking", offered: slots.map((s) => s.toISOString()), offeredType: r.type.slug, offerRound: (state.offerRound ?? 0) + 1 },
  };
}

/** Picks the booking type the caller described ("LegalShield review", "speaking"…). */
async function matchBookingType(text: string): Promise<string | undefined> {
  const db = await getDb();
  const types = await db.select().from(schema.bookingTypes).where(eq(schema.bookingTypes.active, true));
  const t = text.toLowerCase().replace(/legal shield/g, "legalshield");
  let best: { slug: string; score: number } | undefined;
  for (const bt of types) {
    const words = `${bt.name} ${bt.slug}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !["call", "with", "review", "consult"].includes(w));
    const score = words.filter((w) => t.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { slug: bt.slug, score };
  }
  return best?.slug;
}

export async function handleTurn(callId: string, utteranceRaw: string, stateIn: CallState): Promise<TurnResult> {
  const db = await getDb();
  const settings = await getSetting("receptionist");
  const tz = await getSetting("timezone");
  const utterance = (utteranceRaw ?? "").trim();
  let state: CallState = { ...stateIn, turns: (stateIn.turns ?? 0) + 1 };
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
  if (!call) throw new Error("Call not found");

  const respond = async (reply: string, action: CallAction, patch: Partial<CallRow> = {}): Promise<TurnResult> => {
    await appendTurns(callId, [...(utterance ? [heard(utterance)] : []), say(reply)], patch);
    if (action.type === "hangup") await finalizeCall(callId);
    return { callId, reply, state, action };
  };

  // Silence handling.
  if (!utterance) {
    state.silent = (state.silent ?? 0) + 1;
    if (state.silent >= 2) {
      state.stage = "done";
      return respond("I'm sorry, I can't hear you. Please call back or text this number anytime. Goodbye.", { type: "hangup" });
    }
    return respond("I'm sorry, I didn't catch that. Could you say it again?", { type: "continue" });
  }
  state.silent = 0;

  // Urgency is checked on every turn, at every stage.
  const c = state.stage === "booking_offer" || state.stage === "wrapup" ? null : await classify(utterance);
  const quickUrgent = settings.urgentKeywords.some((k) => k && utterance.toLowerCase().includes(k.toLowerCase()));
  if ((c?.urgent || quickUrgent) && state.intent !== "urgent") {
    state = { ...state, intent: "urgent", reason: state.reason ?? (c?.reason || utterance), callerName: state.callerName ?? c?.callerName, stage: "done" };
    return respond("I understand this is urgent. I'm connecting you to Pamela right now — please stay on the line.", { type: "transfer", to: settings.transferNumber }, { urgency: "urgent", intent: "urgent", disposition: "transferred", status: "transferred" });
  }
  if (c?.spam) {
    state = { ...state, intent: "spam", stage: "done" };
    return respond("Thank you, but we're not interested. Please remove this number from your list. Goodbye.", { type: "hangup" }, { urgency: "spam", intent: "spam", disposition: "spam" });
  }

  if ((state.turns ?? 0) > 10) {
    state.stage = "done";
    return respond("Thank you so much. I've passed everything along to Pamela, and she'll follow up soon. Goodbye.", { type: "hangup" });
  }

  switch (state.stage) {
    case "screen":
    case "name": {
      if (c?.callerName) state.callerName = c.callerName;
      if (state.stage === "screen") {
        state.reason = c?.reason || utterance;
        state.intent = c?.intent ?? "message";
      } else if (!state.callerName && utterance.split(/\s+/).length <= 4) {
        state.callerName = utterance.replace(/[.!?]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
      }
      if (state.callerName) await saveCallerName(call, state.callerName);
      if (!state.callerName && state.stage === "screen") {
        state.stage = "name";
        return respond("I'd be glad to help with that. May I have your name, please?", { type: "continue" }, { intent: state.intent ?? null });
      }
      const first = state.callerName?.split(" ")[0];
      if (state.intent === "booking") {
        const o = await offerSlots(state, tz);
        state = o.state;
        return respond(`${first ? `Thank you, ${first}. ` : ""}${o.reply}`, { type: "continue" }, { intent: "booking" });
      }
      state.stage = "message";
      const reasonKnown = (state.reason ?? "").split(/\s+/).length >= 6;
      return respond(
        reasonKnown
          ? `Thank you${first ? `, ${first}` : ""}. I'll make sure Pamela gets this. Is there anything else you'd like me to tell her, and is this the best number to reach you?`
          : `Thank you${first ? `, ${first}` : ""}. What would you like me to tell Pamela?`,
        { type: "continue" },
        { intent: state.intent ?? "message" },
      );
    }
    case "booking_offer": {
      const offered = state.offered ?? [];
      if (NONE_OF.test(utterance) && !/\b(first|second|third)\b/i.test(utterance)) {
        if ((state.offerRound ?? 1) >= 3) {
          state.stage = "message";
          return respond("Let me have Pamela reach out personally to find a time that works. Is there a day or time that's best for you?", { type: "continue" });
        }
        const o = await offerSlots(state, tz, offered.length ? new Date(offered[offered.length - 1]) : undefined);
        state = o.state;
        return respond(`No problem. ${o.reply}`, { type: "continue" });
      }
      const idx = parseChoice(utterance, offered, tz);
      if (idx < 0) {
        return respond(`Sorry, which time would you like? ${offered.map((s, i) => `${["First", "Second", "Third"][i]}, ${formatSlot(new Date(s), tz)}`).join(". ")}.`, { type: "continue" });
      }
      try {
        const r = await createBooking({
          bookingType: state.offeredType ?? "discovery",
          startsAt: new Date(offered[idx]),
          contactId: call.contactId,
          name: state.callerName,
          phone: call.fromNumber,
          source: "receptionist",
          notes: state.reason ?? null,
        });
        state = { ...state, stage: "wrapup", bookingId: r.booking.id };
        return respond(`You're all set for ${r.startsAtLocal}, ${tzLabel(tz)}. Pamela will call you at this number. Is there anything else I can help with?`, { type: "continue" }, { disposition: "booked", bookingId: r.booking.id });
      } catch (e) {
        const msg = e instanceof BookingError ? "That time was just taken." : "I had trouble booking that.";
        const o = await offerSlots(state, tz);
        state = o.state;
        return respond(`${msg} ${o.reply}`, { type: "continue" });
      }
    }
    case "message": {
      state.message = [state.message, utterance].filter(Boolean).join(" ");
      if (BOOKING.test(utterance) && state.intent !== "booking") {
        const o = await offerSlots(state, tz);
        state = o.state;
        return respond(o.reply, { type: "continue" });
      }
      state.stage = "wrapup";
      return respond("Got it. I'll pass that along to Pamela right away. Is there anything else?", { type: "continue" }, { disposition: call.disposition ?? "message" });
    }
    case "wrapup": {
      // "Anything else?" → a bare "yes" means they have more to say, not goodbye.
      if (/^(yes|yeah|yep|yup|sure|actually|wait|one more)\b/i.test(utterance) && utterance.split(/\s+/).length <= 3) {
        return respond("Of course. What else would you like me to pass along?", { type: "continue" });
      }
      if (DONE.test(utterance) || utterance.split(/\s+/).length <= 2) {
        state.stage = "done";
        return respond("Thank you for calling A Cup of Compassion. Have a blessed day. Goodbye.", { type: "hangup" });
      }
      if (BOOKING.test(utterance) && !state.bookingId) {
        const o = await offerSlots(state, tz);
        state = o.state;
        return respond(o.reply, { type: "continue" });
      }
      state.message = [state.message, utterance].filter(Boolean).join(" ");
      return respond("I've added that for Pamela. Anything else?", { type: "continue" });
    }
    default:
      return respond("Thank you for calling. Goodbye.", { type: "hangup" });
  }
}

async function saveCallerName(call: CallRow, name: string) {
  if (!call.contactId) return;
  const db = await getDb();
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, call.contactId));
  if (c && !c.firstName && !c.lastName) {
    await db.update(schema.contacts).set({ ...splitName(name), updatedAt: new Date() }).where(eq(schema.contacts.id, c.id));
  }
}

/** Idempotent: summarises, logs to the contact timeline and emits call.completed once. */
export async function finalizeCall(callId: string, opts: { status?: string } = {}) {
  const db = await getDb();
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
  if (!call || call.endedAt) return call ?? null;
  const transcript = call.turns.map((t) => `${t.role === "caller" ? "Caller" : "Receptionist"}: ${t.text}`).join("\n");
  const callerLines = call.turns.filter((t) => t.role === "caller").map((t) => t.text);
  const disposition = call.disposition ?? (callerLines.length ? "message" : "hangup");
  const ai = callerLines.length
    ? await aiText("summarize", "Summarize this phone call for Pamela in 1–2 sentences: who called, what they want, and any follow-up needed. No preamble.", transcript, 200).catch(() => null)
    : null;
  const summary =
    ai?.text ||
    (callerLines.length
      ? `${disposition === "booked" ? "Booked a call" : disposition === "transferred" ? "Urgent — transferred to Pamela" : disposition === "spam" ? "Spam call" : "Left a message"}: “${(callerLines.filter((l) => l.split(/\s+/).length > 3).join(" ") || callerLines.join(" ")).slice(0, 280)}”`
      : "Caller hung up without speaking.");
  const [done] = await db
    .update(schema.calls)
    .set({ endedAt: new Date(), summary, disposition, status: opts.status ?? (call.status === "in_progress" ? "completed" : call.status) })
    .where(eq(schema.calls.id, callId))
    .returning();
  if (disposition !== "spam" || call.contactId) {
    await logActivity({
      type: "call",
      direction: "inbound",
      contactId: call.contactId,
      title: `Receptionist call · ${disposition}${call.urgency === "urgent" ? " (urgent)" : ""}`,
      body: `${summary}\n\n${transcript}`,
      subjectType: "call",
      subjectId: call.id,
      meta: { from: call.fromNumber, urgency: call.urgency },
    });
  }
  await emit("call.completed", { callId, contactId: call.contactId, disposition, urgency: call.urgency, summary, from: call.fromNumber }, "receptionist");
  if (call.contactId && disposition === "message") await emit("lead.captured", { contactId: call.contactId, source: "phone call" }, "receptionist");
  return done;
}

/* ───────────── TwiML helpers ───────────── */

export function xmlEscape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export const encodeState = (s: CallState & { callId: string }) => Buffer.from(JSON.stringify(s)).toString("base64url");
export function decodeState(s: string | null): (CallState & { callId: string }) | null {
  if (!s) return null;
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    return v && typeof v.callId === "string" && /^[0-9a-f-]{36}$/i.test(v.callId) ? v : null;
  } catch {
    return null;
  }
}

const VOICE = 'voice="Polly.Joanna-Neural"';

export function twimlFor(r: TurnResult) {
  const s = encodeState({ ...r.state, callId: r.callId });
  const gatherUrl = xmlEscape(`/api/webhooks/twilio/voice/gather?s=${s}`);
  if (r.action.type === "transfer") {
    const dialAction = xmlEscape(`/api/webhooks/twilio/voice/dial?s=${s}`);
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say ${VOICE}>${xmlEscape(r.reply)}</Say><Dial timeout="25" action="${dialAction}" method="POST">${xmlEscape(r.action.to)}</Dial></Response>`;
  }
  if (r.action.type === "hangup") {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say ${VOICE}>${xmlEscape(r.reply)}</Say><Hangup/></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="${gatherUrl}" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" language="en-US"><Say ${VOICE}>${xmlEscape(r.reply)}</Say></Gather><Redirect method="POST">${gatherUrl}</Redirect></Response>`;
}
