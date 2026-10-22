import { getSetting } from "./settings";
import { aiText } from "./ai";

/** Applies Pamela's custom dictionary (case-insensitive, whole words). */
export function applyDictionary(text: string, dict: { from: string; to: string }[]) {
  let out = text;
  for (const { from, to } of dict) {
    if (!from) continue;
    const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "gi");
    out = out.replace(re, () => to); // literal: "$" in a replacement must not be a pattern
  }
  return out;
}

export async function cleanupDictation(raw: string, useAi = true): Promise<{ text: string; provider: string }> {
  const dict = await getSetting("dictionary");
  let text = applyDictionary(raw.trim(), dict);
  let provider = "dictionary";
  if (useAi && text.split(/\s+/).length > 3) {
    const r = await aiText(
      "summarize",
      `Clean up dictated text. Fix punctuation, capitalization and obvious speech-recognition mistakes. Remove filler words (um, uh, like). Keep the speaker's wording and meaning — do not add content. These terms must be spelled exactly: ${dict.map((d) => d.to).join(", ")}. Return only the cleaned text.`,
      text,
      800,
    );
    if (r?.text) {
      text = applyDictionary(r.text, dict);
      provider = r.provider;
    }
  }
  if (provider === "dictionary") text = text.replace(/\b(um+|uh+|erm|you know)\b[,]?\s*/gi, "").replace(/\s{2,}/g, " ").trim();
  if (provider === "dictionary" && text) text = text[0].toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : ".");
  return { text, provider };
}
