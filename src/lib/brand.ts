/**
 * Brand rules for A Cup of Compassion. These are enforced on every outbound
 * draft (approval gate runs `lintBrand`) and drive the UI theme.
 */
export const BRAND = {
  name: "A Cup of Compassion",
  product: "Pamela OS",
  owner: "Pamela",
  purple: "#6a1b9a",
  purpleDark: "#4a126c",
  purpleLight: "#f3e8f8",
  ink: "#1f1530",
  paper: "#ffffff",
  phoneDisplay: "(323) 943-ACUP",
  phoneE164: "+13239432287", // A=2 C=2 U=8 P=7
  urgentTransferDisplay: "614-598-7466",
  urgentTransferE164: "+16145987466",
  timezone: "America/Los_Angeles",
  serifFont: "'Libre Baskerville', Georgia, 'Times New Roman', serif",
  sansFont: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;

export type BrandKit = {
  name: string;
  purple: string;
  phoneDisplay: string;
  tagline: string;
  signature: string;
  bannedPhrases: string[];
  voiceNotes: string;
  /** Art direction the Create studio adds to every image and video prompt wired to the Brand kit. */
  visualStyle: string;
};

export const DEFAULT_BRAND_KIT: BrandKit = {
  name: BRAND.name,
  purple: BRAND.purple,
  phoneDisplay: BRAND.phoneDisplay,
  tagline: "Pouring compassion into every conversation.",
  signature: `With compassion,\nPamela\n${BRAND.name}\n${BRAND.phoneDisplay}`,
  bannedPhrases: ["ACOC", "Cup of Compassion"],
  voiceNotes:
    "Warm, faith-forward, direct and encouraging. Short paragraphs. Speaks like a trusted friend and advocate. Never pushy, never corporate jargon.",
  visualStyle:
    "Warm, hopeful and dignified. Real, diverse families and women in everyday community moments. Soft natural window light, gentle depth of field, editorial photography. Deep royal purple (#6a1b9a) accents with clean white space and soft lavender tones. Uplifting, never staged or corporate.",
};

const ABBREVIATIONS = [/\bACOC\b/i, /\bA\.?C\.?O\.?C\.?\b/i];
// "Cup of Compassion" without the leading "A " is not the brand name.
const BARE_NAME = /\bcup of compassion\b/i;
const PHONE_VARIANTS = [/\(?323\)?[\s.-]*943[\s.-]*2287/, /\(?323\)?[\s.-]*943[\s.-]*acup/i];
const ALLOWED_HEX = new Set([BRAND.purple, BRAND.purpleDark, BRAND.purpleLight, BRAND.ink, "#ffffff", "#000000"].map((h) => h.toLowerCase()));

export type BrandIssue = { code: string; message: string };

/** Returns brand violations found in outbound text. */
export function lintBrand(text: string, kit: BrandKit = DEFAULT_BRAND_KIT): BrandIssue[] {
  const issues: BrandIssue[] = [];
  if (!text) return issues;
  for (const re of ABBREVIATIONS) {
    if (re.test(text)) {
      issues.push({ code: "abbrev", message: `Use the full name “${kit.name}” — no abbreviations.` });
      break;
    }
  }
  const stripped = text.split(kit.name).join(""); // exact case only — "a cup of compassion" is still off-brand
  if (BARE_NAME.test(stripped)) {
    issues.push({ code: "bare_name", message: `Write “${kit.name}” with the leading “A”.` });
  }
  for (const re of PHONE_VARIANTS) {
    const m = text.match(re);
    if (m && m[0] !== kit.phoneDisplay) {
      issues.push({ code: "phone", message: `Format the phone number as ${kit.phoneDisplay}.` });
      break;
    }
  }
  for (const phrase of kit.bannedPhrases) {
    if (phrase === "Cup of Compassion" || phrase === "ACOC") continue; // handled above
    if (phrase && text.toLowerCase().includes(phrase.toLowerCase())) {
      issues.push({ code: "banned", message: `Avoid “${phrase}”.` });
    }
  }
  const hexes = text.match(/#[0-9a-f]{6}\b/gi) ?? [];
  if (hexes.some((h) => !ALLOWED_HEX.has(h.toLowerCase()))) {
    issues.push({ code: "color", message: `Only the brand purple ${kit.purple} may be used in branded assets.` });
  }
  return issues;
}

/** Applies the mechanical fixes (name + phone). Tone issues are left for review. */
export function autoFixBrand(text: string, kit: BrandKit = DEFAULT_BRAND_KIT): string {
  let out = text;
  for (const re of ABBREVIATIONS) out = out.replace(new RegExp(re.source, "gi"), kit.name);
  // Normalise every "(a) cup of compassion" spelling to the exact brand name.
  out = out.replace(/\b(?:(?:a|the)\s+)?cup of compassion\b/gi, kit.name);
  for (const re of PHONE_VARIANTS) out = out.replace(new RegExp(re.source, "gi"), kit.phoneDisplay);
  return out;
}
