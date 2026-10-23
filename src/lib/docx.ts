import zlib from "node:zlib";

/**
 * Just enough .docx reading to show a Word document inside the Library:
 * pulls word/document.xml out of the zip and turns it into paragraphs.
 * No layout, images or tables beyond their text — "Make an editable copy"
 * covers editing.
 */

function unzipEntry(zip: Buffer, wanted: string): Buffer | null {
  // End of central directory record sits in the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === wanted) {
      if (zip.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const body = zip.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(body);
      if (method === 8) return zlib.inflateRawSync(body);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

export type DocxParagraph = { text: string; heading: number | null; list: boolean };

export function docxParagraphs(data: Buffer): DocxParagraph[] | null {
  let xml: string;
  try {
    const entry = unzipEntry(data, "word/document.xml");
    if (!entry) return null;
    xml = entry.toString("utf8");
  } catch {
    return null;
  }
  const out: DocxParagraph[] = [];
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const p = m[0];
    const text = decode(
      p
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:(br|cr)\/>/g, "\n")
        .replace(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<(?!\/?w:t[ >])[^>]+>/g, (_, t) => t ?? "")
        .replace(/<\/?w:t[^>]*>/g, ""),
    );
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const h = style.match(/^heading\s?(\d)$/i)?.[1];
    out.push({ text, heading: style === "Title" ? 1 : h ? Math.min(Number(h), 6) : null, list: /<w:numPr[\s/>]/.test(p) });
  }
  return out;
}

/** Plain-text / Markdown rendering for an editable copy. */
export function docxToMarkdown(paras: DocxParagraph[]) {
  return paras
    .map((p) => (p.heading ? `${"#".repeat(p.heading)} ${p.text}` : p.list ? `- ${p.text}` : p.text))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
