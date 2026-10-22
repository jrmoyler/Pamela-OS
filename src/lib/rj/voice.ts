import { aiJson } from "../ai";
import { getSetting } from "../settings";
import { contactName, type Contact } from "../crm";
import { autoFixBrand } from "../brand";

/** The system prompt that makes every model sound like Pamela. */
export async function herVoiceSystem() {
  const kit = await getSetting("brandKit");
  return [
    `You write on behalf of Pamela, founder of ${kit.name}.`,
    `Voice: ${kit.voiceNotes}`,
    `Brand rules: always write the full name "${kit.name}" (never abbreviate). The phone number is ${kit.phoneDisplay}.`,
    `Sign emails with:\n${kit.signature}`,
    "Never invent facts, prices, dates or promises that aren't in the context. If something is unknown, leave a [bracketed placeholder] for Pamela.",
  ].join("\n");
}

export async function draftInHerVoice(opts: {
  channel: "email" | "sms" | "dm";
  instructions: string;
  contact?: Pick<Contact, "firstName" | "lastName" | "email" | "phone"> | null;
  context?: string;
}): Promise<{ subject: string; body: string; provider: string }> {
  const kit = await getSetting("brandKit");
  const name = opts.contact ? contactName(opts.contact) : "there";
  const first = opts.contact?.firstName || "friend";
  const r = await aiJson<{ subject?: string; body: string }>(
    "drafting",
    await herVoiceSystem(),
    [
      `Draft a ${opts.channel === "sms" ? "text message (under 300 characters, no signature block)" : opts.channel === "dm" ? "social DM (short, warm)" : "email"} to ${name}.`,
      `What it needs to do: ${opts.instructions}`,
      opts.context ? `Context:\n${opts.context}` : "",
      `Return {"subject": string, "body": string}.`,
    ].join("\n\n"),
  );
  if (r?.data?.body) {
    return { subject: autoFixBrand(r.data.subject || "A note from Pamela", kit), body: autoFixBrand(r.data.body, kit), provider: r.provider };
  }
  // Offline template — still on-brand, clearly a starting point for Pamela to edit.
  const body =
    opts.channel === "email"
      ? `Hi ${first},\n\n${opts.instructions}\n\n${kit.signature}`
      : `Hi ${first}, it's Pamela with ${kit.name}. ${opts.instructions}`;
  return { subject: "A note from Pamela", body, provider: "template" };
}
