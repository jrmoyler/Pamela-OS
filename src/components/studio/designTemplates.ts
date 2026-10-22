/**
 * Brand-locked design templates. Only the listed fields are editable; colours,
 * fonts, the full brand name and the phone footer are fixed by the template.
 * Pure functions — used on the server (list thumbnails) and in the browser.
 */
export type DesignField = "headline" | "body" | "date" | "cta" | "photo";

export type DesignTemplate = {
  key: string;
  name: string;
  format: "square" | "flyer" | "story" | "cover";
  width: number;
  height: number;
  fields: DesignField[];
  description: string;
};

export const TEMPLATES: DesignTemplate[] = [
  { key: "quote", name: "Quote card", format: "square", width: 1080, height: 1080, fields: ["headline", "body"], description: "A serif quote on brand purple. Body = attribution." },
  { key: "flyer", name: "Event flyer", format: "flyer", width: 1080, height: 1350, fields: ["headline", "body", "date", "cta", "photo"], description: "Workshops, talks, gatherings." },
  { key: "book", name: "Book promo", format: "flyer", width: 1080, height: 1350, fields: ["headline", "body", "cta", "photo"], description: "Book or product spotlight with cover photo." },
  { key: "cover", name: "Podcast / song cover", format: "cover", width: 1080, height: 1080, fields: ["headline", "body", "photo"], description: "Square cover art for episodes and singles." },
  { key: "story", name: "Instagram story", format: "story", width: 1080, height: 1920, fields: ["headline", "body", "date", "cta", "photo"], description: "Vertical 9:16 story." },
];

export const FIELD_LABELS: Record<DesignField, string> = { headline: "Headline", body: "Body", date: "Date / time", cta: "Call to action", photo: "Photo" };

const PURPLE = "#6a1b9a";
const WHITE = "#ffffff";
const SERIF = "'Libre Baskerville', Georgia, 'Times New Roman', serif";
const SANS = "Inter, 'Helvetica Neue', Arial, sans-serif";
const FOOTER = "A Cup of Compassion  ·  (323) 943-ACUP";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = (text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur ? cur + " " + w : w).length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

function textBlock(o: { text: string; x: number; y: number; size: number; maxChars: number; maxLines: number; font: string; weight?: number; fill?: string; anchor?: "start" | "middle"; lineHeight?: number; italic?: boolean }) {
  const lines = wrapLines(o.text, o.maxChars, o.maxLines);
  const lh = o.lineHeight ?? 1.25;
  return `<text x="${o.x}" y="${o.y}" font-family="${o.font}" font-size="${o.size}" font-weight="${o.weight ?? 400}" ${o.italic ? 'font-style="italic"' : ""} fill="${o.fill ?? WHITE}" text-anchor="${o.anchor ?? "start"}">${lines
    .map((l, i) => `<tspan x="${o.x}" dy="${i === 0 ? 0 : o.size * lh}">${esc(l)}</tspan>`)
    .join("")}</text>`;
}

function photo(href: string | undefined, x: number, y: number, w: number, h: number, id: string, round = false) {
  if (!href) {
    // Placeholder visible on both purple and white backgrounds.
    const r = round ? `rx="${w / 2}"` : 'rx="24"';
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${r} fill="${PURPLE}" fill-opacity="0.08" stroke="${WHITE}" stroke-opacity="0.5" stroke-width="4" stroke-dasharray="16 12"/><rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" ${round ? `rx="${(w - 12) / 2}"` : 'rx="20"'} fill="none" stroke="${PURPLE}" stroke-opacity="0.3" stroke-width="3" stroke-dasharray="16 12"/><text x="${x + w / 2}" y="${y + h / 2 + 12}" font-family="${SANS}" font-size="32" fill="${PURPLE}" fill-opacity="0.45" text-anchor="middle">Photo</text>`;
  }
  return `<defs><clipPath id="${id}">${round ? `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2}"/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24"/>`}</clipPath></defs><image href="${esc(href)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
}

function footer(w: number, h: number, onPurple: boolean) {
  return `<rect x="0" y="${h - 90}" width="${w}" height="90" fill="${onPurple ? WHITE : PURPLE}"/><text x="${w / 2}" y="${h - 35}" font-family="${SERIF}" font-size="30" fill="${onPurple ? PURPLE : WHITE}" text-anchor="middle">${esc(FOOTER)}</text>`;
}

/** Renders a template to an SVG string. `photoHref` may be an in-app URL (preview) or a data URL (export). */
export function renderDesignSvg(templateKey: string, fields: Record<string, string>, photoHref?: string): string {
  const t = TEMPLATES.find((x) => x.key === templateKey) ?? TEMPLATES[0];
  const { width: W, height: H } = t;
  const f = (k: string) => (fields[k] ?? "").trim();
  let body = "";
  switch (t.key) {
    case "quote":
      body = `<rect width="${W}" height="${H}" fill="${PURPLE}"/>
        <text x="110" y="300" font-family="${SERIF}" font-size="260" fill="${WHITE}" fill-opacity="0.25">“</text>
        ${textBlock({ text: f("headline") || "Compassion is the cup we pour from — and the cup we refill.", x: 110, y: 380, size: 62, maxChars: 26, maxLines: 7, font: SERIF, lineHeight: 1.35 })}
        ${textBlock({ text: `— ${f("body") || "Pamela"}`, x: 110, y: H - 170, size: 36, maxChars: 40, maxLines: 1, font: SANS, weight: 600 })}
        ${footer(W, H, true)}`;
      break;
    case "flyer":
      body = `<rect width="${W}" height="${H}" fill="${WHITE}"/>
        <rect width="${W}" height="420" fill="${PURPLE}"/>
        ${textBlock({ text: f("headline") || "Your event title", x: 80, y: 150, size: 76, maxChars: 22, maxLines: 3, font: SERIF, weight: 700 })}
        ${f("date") ? textBlock({ text: f("date"), x: 80, y: 390, size: 34, maxChars: 50, maxLines: 1, font: SANS, weight: 600 }) : ""}
        ${photo(photoHref, 80, 470, W - 160, 420, "p-flyer")}
        ${textBlock({ text: f("body") || "Tell people what to expect and why they should come.", x: 80, y: 960, size: 36, maxChars: 48, maxLines: 4, font: SERIF, fill: "#1f1530", lineHeight: 1.4 })}
        ${f("cta") ? `<rect x="80" y="${H - 250}" width="${W - 160}" height="110" rx="20" fill="${PURPLE}"/>${textBlock({ text: f("cta"), x: W / 2, y: H - 180, size: 40, maxChars: 40, maxLines: 1, font: SANS, weight: 700, anchor: "middle" })}` : ""}
        ${footer(W, H, false)}`;
      break;
    case "book":
      body = `<rect width="${W}" height="${H}" fill="${PURPLE}"/>
        ${photo(photoHref, 600, 160, 400, 600, "p-book")}
        <text x="80" y="200" font-family="${SANS}" font-size="28" font-weight="700" fill="${WHITE}" letter-spacing="6">NEW FROM PAMELA</text>
        ${textBlock({ text: f("headline") || "Book title", x: 80, y: 300, size: 64, maxChars: 14, maxLines: 6, font: SERIF, weight: 700, lineHeight: 1.2 })}
        ${textBlock({ text: f("body") || "A short, heartfelt line about the book.", x: 80, y: 880, size: 38, maxChars: 44, maxLines: 4, font: SERIF, italic: true, lineHeight: 1.4 })}
        ${f("cta") ? `<rect x="80" y="${H - 260}" width="520" height="100" rx="50" fill="${WHITE}"/>${textBlock({ text: f("cta"), x: 340, y: H - 196, size: 34, maxChars: 28, maxLines: 1, font: SANS, weight: 700, anchor: "middle", fill: PURPLE })}` : ""}
        ${footer(W, H, true)}`;
      break;
    case "cover":
      body = `<rect width="${W}" height="${H}" fill="${PURPLE}"/>
        ${photo(photoHref, W / 2 - 220, 110, 440, 440, "p-cover", true)}
        ${textBlock({ text: f("headline") || "Title", x: W / 2, y: 680, size: 72, maxChars: 22, maxLines: 2, font: SERIF, weight: 700, anchor: "middle" })}
        ${textBlock({ text: f("body") || "A Cup of Compassion", x: W / 2, y: 880, size: 34, maxChars: 44, maxLines: 1, font: SANS, weight: 500, anchor: "middle" })}
        ${footer(W, H, true)}`;
      break;
    case "story":
      body = `<rect width="${W}" height="${H}" fill="${PURPLE}"/>
        ${photo(photoHref, 90, 200, W - 180, 760, "p-story")}
        ${textBlock({ text: f("headline") || "Big news", x: 90, y: 1080, size: 84, maxChars: 18, maxLines: 3, font: SERIF, weight: 700 })}
        ${f("date") ? textBlock({ text: f("date"), x: 90, y: 1400, size: 40, maxChars: 40, maxLines: 1, font: SANS, weight: 600 }) : ""}
        ${textBlock({ text: f("body"), x: 90, y: 1480, size: 40, maxChars: 40, maxLines: 4, font: SERIF, lineHeight: 1.4 })}
        ${f("cta") ? `<rect x="90" y="${H - 300}" width="${W - 180}" height="110" rx="55" fill="${WHITE}"/>${textBlock({ text: f("cta"), x: W / 2, y: H - 228, size: 42, maxChars: 36, maxLines: 1, font: SANS, weight: 700, anchor: "middle", fill: PURPLE })}` : ""}
        ${footer(W, H, true)}`;
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg>`;
}
