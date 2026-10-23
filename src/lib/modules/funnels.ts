import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { FormField, PageBlock } from "../db/schema";
import { findOrCreateContact, logActivity, contactName } from "../crm";
import { emit } from "../events";
import { enroll } from "../sequences";
import { appUrl, signedMediaUrl } from "../outbound";

export type BlockFieldType = "text" | "textarea" | "number" | "money" | "file" | "form" | "booking" | "checkbox";
export type BlockDef = {
  type: string;
  label: string;
  fields: { key: string; label: string; type: BlockFieldType; hint?: string }[];
  defaults: Record<string, unknown>;
};

export const BLOCK_DEFS: BlockDef[] = [
  {
    type: "hero",
    label: "Hero",
    fields: [
      { key: "headline", label: "Headline", type: "text" },
      { key: "subheadline", label: "Subheadline", type: "textarea" },
      { key: "buttonText", label: "Button text", type: "text" },
      { key: "buttonHref", label: "Button link", type: "text", hint: "In-page anchor (#form) or an internal path like /book/discovery" },
      { key: "imageFileId", label: "Image", type: "file" },
    ],
    defaults: { headline: "Pouring compassion into every conversation", subheadline: "A Cup of Compassion", buttonText: "Get started", buttonHref: "#form" },
  },
  {
    type: "text",
    label: "Rich text (serif)",
    fields: [
      { key: "heading", label: "Heading", type: "text" },
      { key: "body", label: "Body", type: "textarea", hint: "Blank line = new paragraph. **bold** works." },
    ],
    defaults: { heading: "", body: "Tell your story here." },
  },
  { type: "image", label: "Image", fields: [{ key: "fileId", label: "Image", type: "file" }, { key: "alt", label: "Alt text", type: "text" }, { key: "caption", label: "Caption", type: "text" }], defaults: {} },
  { type: "video", label: "Video", fields: [{ key: "fileId", label: "Video file", type: "file" }, { key: "caption", label: "Caption", type: "text" }], defaults: {} },
  { type: "form", label: "Form", fields: [{ key: "formId", label: "Form", type: "form" }, { key: "heading", label: "Heading", type: "text" }, { key: "buttonText", label: "Button text", type: "text" }], defaults: { heading: "Stay in touch", buttonText: "Send" } },
  {
    type: "booking",
    label: "Booking",
    fields: [{ key: "slug", label: "Booking type", type: "booking" }, { key: "heading", label: "Heading", type: "text" }, { key: "text", label: "Text", type: "textarea" }],
    defaults: { heading: "Book time with Pamela", text: "Pick a time that works for you." },
  },
  {
    type: "cta",
    label: "Call to action",
    fields: [{ key: "headline", label: "Headline", type: "text" }, { key: "text", label: "Text", type: "textarea" }, { key: "buttonText", label: "Button text", type: "text" }, { key: "buttonHref", label: "Button link", type: "text" }],
    defaults: { headline: "Ready when you are", buttonText: "Let's talk", buttonHref: "#form" },
  },
  { type: "testimonial", label: "Testimonial", fields: [{ key: "quote", label: "Quote", type: "textarea" }, { key: "author", label: "Name", type: "text" }, { key: "role", label: "Role", type: "text" }], defaults: { quote: "Pamela changed how our family handles hard days.", author: "" } },
  {
    type: "product",
    label: "Product / checkout",
    fields: [
      { key: "name", label: "Product name", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "priceCents", label: "Price ($)", type: "money" },
      { key: "imageFileId", label: "Image", type: "file" },
      { key: "buttonText", label: "Button text", type: "text" },
    ],
    defaults: { name: "Signed copy", priceCents: 2500, buttonText: "Buy now" },
  },
  { type: "contact", label: "Contact strip", fields: [{ key: "text", label: "Text", type: "text" }], defaults: { text: "Questions? Call or text" } },
];

export const blockDef = (type: string) => BLOCK_DEFS.find((b) => b.type === type);

export function newBlock(type: string): PageBlock {
  return { id: crypto.randomUUID().slice(0, 8), type, props: { ...(blockDef(type)?.defaults ?? {}) } };
}

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "page"
  );
}

/** Slugs that collide with fixed routes under /p. */
export const RESERVED_SLUGS = ["thanks"];

export async function uniqueSlug(base: string, exceptId?: string) {
  const db = await getDb();
  let slug = slugify(base);
  if (RESERVED_SLUGS.includes(slug)) slug = `${slug}-page`;
  for (let i = 2; ; i++) {
    const [hit] = await db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.slug, slug));
    if (!hit || hit.id === exceptId) return slug;
    slug = `${slugify(base)}-${i}`;
  }
}

/** Only the props a block declares, typed the way the page editor saves them. */
function cleanProps(type: string, props: Record<string, unknown>) {
  const def = blockDef(type)!;
  const out: Record<string, unknown> = { ...def.defaults };
  for (const f of def.fields) {
    if (!(f.key in props)) continue;
    const v = props[f.key];
    if (f.type === "money") out[f.key] = Math.max(0, Math.round(Number(v) || 0));
    else if (f.type === "checkbox") out[f.key] = v === true || v === "true";
    else if (f.type === "file") out[f.key] = typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
    else if (f.type !== "form") out[f.key] = v == null ? "" : String(v).slice(0, 10_000);
  }
  return out;
}

/**
 * A funnel in one go: a landing page plus (when it has a form block) a signup
 * form whose people land as deals in a pipeline stage. The page starts as a
 * draft; going live still goes through Approvals.
 */
export async function createFunnel(input: {
  title: string;
  template?: string;
  slug?: string;
  blocks?: { type: string; props?: Record<string, unknown> }[];
  pipelineId?: string | null;
  stageId?: string | null;
  formTags?: string[];
  formFields?: FormField[];
}) {
  const title = input.title.trim() || "Untitled page";
  const tpl = PAGE_TEMPLATES[input.template ?? ""] ?? PAGE_TEMPLATES[input.blocks?.length ? "blank" : "lead"];
  let blocks: PageBlock[];
  if (input.blocks?.length) {
    blocks = input.blocks.filter((b) => blockDef(b.type)).slice(0, 40).map((b) => ({ ...newBlock(b.type), props: cleanProps(b.type, b.props ?? {}) }));
    if (!blocks.length) throw new Error(`Unknown block types. Use: ${BLOCK_DEFS.map((b) => b.type).join(", ")}.`);
  } else {
    blocks = tpl.blocks.map(newBlock);
    const hero = blocks.find((b) => b.type === "hero");
    if (hero) hero.props.headline = title;
  }
  const db = await getDb();
  let form: typeof schema.forms.$inferSelect | null = null;
  if (blocks.some((b) => b.type === "form")) {
    [form] = await db
      .insert(schema.forms)
      .values({
        name: `${title} signup`,
        fields: input.formFields?.length ? input.formFields : DEFAULT_FORM_FIELDS,
        tags: input.formTags ?? [],
        pipelineId: input.stageId ? (input.pipelineId ?? null) : null,
        stageId: input.pipelineId ? (input.stageId ?? null) : null,
      })
      .returning();
    for (const b of blocks) if (b.type === "form") b.props.formId = form.id;
  }
  const [page] = await db
    .insert(schema.pages)
    .values({ title, slug: await uniqueSlug(input.slug || title), kind: input.blocks?.length ? "landing" : tpl.kind, blocks })
    .returning();
  return { page, form };
}

export const PAGE_TEMPLATES: Record<string, { label: string; kind: string; blocks: string[] }> = {
  blank: { label: "Blank", kind: "landing", blocks: ["hero"] },
  lead: { label: "Lead magnet", kind: "lead_magnet", blocks: ["hero", "text", "form", "testimonial", "contact"] },
  speaking: { label: "Speaking & events", kind: "landing", blocks: ["hero", "text", "testimonial", "booking", "contact"] },
  sales: { label: "Sales page", kind: "sales", blocks: ["hero", "text", "product", "testimonial", "contact"] },
  thanks: { label: "Thank-you page", kind: "thank_you", blocks: ["text", "contact"] },
};

/** Relative signed URL for a stored file, usable on public pages (works on any host). */
export function publicFileUrl(fileId: string, ttlSec = 30 * 86400) {
  const abs = signedMediaUrl(fileId, ttlSec);
  return abs.replace(appUrl(), "");
}

export const DEFAULT_FORM_FIELDS: FormField[] = [
  { key: "name", label: "Your name", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
  { key: "phone", label: "Phone", type: "tel" },
];

export type SubmitResult = { ok: true; redirect: string; contactId?: string; submissionId?: string; spam?: boolean } | { ok: false; error: string };

/** Public form submission: one person → CRM, pipeline, sequence, event bus. */
export async function submitForm(formId: string, raw: Record<string, string>): Promise<SubmitResult> {
  const db = await getDb();
  const [form] = await db.select().from(schema.forms).where(eq(schema.forms.id, formId));
  if (!form) return { ok: false, error: "Form not found" };
  const thanks = form.thankYouSlug ? `/p/${form.thankYouSlug}?f=${form.id}` : `/p/thanks/${form.id}`;

  // Honeypot: bots fill the hidden "website" field. Pretend success.
  if (raw.website && raw.website.trim()) return { ok: true, redirect: thanks, spam: true };

  const data: Record<string, string> = {};
  for (const f of form.fields) {
    const v = (raw[f.key] ?? "").toString().trim().slice(0, 5000);
    if (f.required && !v) return { ok: false, error: `${f.label} is required` };
    if (v) data[f.key] = v;
  }
  const find = (pred: (f: FormField) => boolean) => form.fields.filter(pred).map((f) => data[f.key]).find(Boolean);
  const email = find((f) => f.type === "email" || /email/i.test(f.key));
  const phone = find((f) => f.type === "tel" || /phone/i.test(f.key));
  const firstName = data.first_name ?? data.firstName;
  const lastName = data.last_name ?? data.lastName;
  const name = data.name ?? data.full_name;
  if (!email && !phone) return { ok: false, error: "Please share an email or phone number" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email doesn't look right" };

  const { contact, created } = await findOrCreateContact({
    email,
    phone,
    name,
    firstName,
    lastName,
    company: data.company ?? data.organization ?? null,
    source: `form: ${form.name}`,
    tags: form.tags,
    relationshipTypes: form.relationshipType ? [form.relationshipType] : [],
  });
  const [submission] = await db.insert(schema.formSubmissions).values({ formId: form.id, contactId: contact.id, data }).returning();
  await db.update(schema.forms).set({ submissions: sql`${schema.forms.submissions} + 1` }).where(eq(schema.forms.id, form.id));
  await logActivity({
    type: "form",
    direction: "inbound",
    contactId: contact.id,
    title: `Submitted “${form.name}”`,
    body: form.fields.filter((f) => data[f.key]).map((f) => `${f.label}: ${data[f.key]}`).join("\n"),
    subjectType: "form",
    subjectId: form.id,
    meta: { submissionId: submission.id },
  });
  if (created) await emit("contact.created", { contactId: contact.id, source: "form" }, "funnels");

  if (form.pipelineId) {
    const stages = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.pipelineId, form.pipelineId)).orderBy(asc(schema.pipelineStages.position));
    const stage = stages.find((s) => s.id === form.stageId) ?? stages[0];
    if (stage) {
      const [deal] = await db
        .insert(schema.deals)
        .values({ pipelineId: form.pipelineId, stageId: stage.id, contactId: contact.id, title: `${contactName(contact)} · ${form.name}` })
        .returning();
      await logActivity({ type: "system", contactId: contact.id, dealId: deal.id, title: `Added to pipeline · ${stage.name}` });
      await emit("deal.created", { dealId: deal.id, pipelineId: form.pipelineId, contactId: contact.id }, "funnels");
    }
  }
  if (form.sequenceId) await enroll(form.sequenceId, contact.id);

  await emit("form.submitted", { formId: form.id, formName: form.name, contactId: contact.id, data }, "funnels");
  await emit("lead.captured", { contactId: contact.id, source: `form: ${form.name}`, formId: form.id }, "funnels");
  return { ok: true, redirect: thanks, contactId: contact.id, submissionId: submission.id };
}
