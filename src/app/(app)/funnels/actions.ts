"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { FormField, PageBlock } from "@/lib/db/schema";
import { putFile } from "@/lib/storage";
import { createApproval } from "@/lib/approvals";
import { contactName } from "@/lib/crm";
import { appUrl } from "@/lib/outbound";
import { createPaymentRequest } from "@/lib/modules/payments";
import { PAGE_TEMPLATES, RESERVED_SLUGS, DEFAULT_FORM_FIELDS, blockDef, newBlock, slugify } from "@/lib/modules/funnels";

async function uniqueSlug(base: string, exceptId?: string) {
  const db = await getDb();
  let slug = slugify(base);
  if (RESERVED_SLUGS.includes(slug)) slug = `${slug}-page`;
  for (let i = 2; ; i++) {
    const [hit] = await db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.slug, slug));
    if (!hit || hit.id === exceptId) return slug;
    slug = `${slugify(base)}-${i}`;
  }
}

async function getPage(id: string) {
  const db = await getDb();
  const [page] = await db.select().from(schema.pages).where(eq(schema.pages.id, id));
  if (!page) throw new Error("Page not found");
  return page;
}

async function saveBlocks(id: string, blocks: PageBlock[]) {
  const db = await getDb();
  await db.update(schema.pages).set({ blocks, updatedAt: new Date() }).where(eq(schema.pages.id, id));
  revalidatePath(`/funnels/pages/${id}`);
}

/* ───────────── Pages ───────────── */

export async function createPage(form: FormData) {
  const title = String(form.get("title") || "Untitled page").trim();
  const tpl = PAGE_TEMPLATES[String(form.get("template") || "blank")] ?? PAGE_TEMPLATES.blank;
  const blocks = tpl.blocks.map(newBlock);
  const hero = blocks.find((b) => b.type === "hero");
  if (hero) hero.props.headline = title;
  const db = await getDb();
  const [page] = await db
    .insert(schema.pages)
    .values({ title, slug: await uniqueSlug(String(form.get("slug") || title)), kind: tpl.kind, blocks })
    .returning();
  redirect(`/funnels/pages/${page.id}`);
}

export async function updatePageMeta(id: string, form: FormData) {
  const db = await getDb();
  await db
    .update(schema.pages)
    .set({ title: String(form.get("title") || "Untitled"), slug: await uniqueSlug(String(form.get("slug") || form.get("title")), id), kind: String(form.get("kind") || "landing"), updatedAt: new Date() })
    .where(eq(schema.pages.id, id));
  revalidatePath(`/funnels/pages/${id}`);
}

export async function addBlock(id: string, form: FormData) {
  const type = String(form.get("type"));
  if (!blockDef(type)) return;
  const page = await getPage(id);
  await saveBlocks(id, [...page.blocks, newBlock(type)]);
}

export async function updateBlock(id: string, blockId: string, form: FormData) {
  const page = await getPage(id);
  const blocks = page.blocks.map((b) => ({ ...b, props: { ...b.props } }));
  const block = blocks.find((b) => b.id === blockId);
  const def = block && blockDef(block.type);
  if (!block || !def) return;
  for (const f of def.fields) {
    if (f.type === "file") {
      const file = form.get(f.key);
      if (form.get(`remove_${f.key}`) === "on") block.props[f.key] = null;
      else if (file instanceof File && file.size > 0) {
        const saved = await putFile(Buffer.from(await file.arrayBuffer()), file.name, file.type || "application/octet-stream");
        block.props[f.key] = saved.id;
      }
    } else if (f.type === "money") {
      block.props[f.key] = Math.max(0, Math.round(Number(form.get(f.key) || 0) * 100));
    } else if (f.type === "checkbox") {
      block.props[f.key] = form.get(f.key) === "on";
    } else {
      block.props[f.key] = String(form.get(f.key) ?? "");
    }
  }
  await saveBlocks(id, blocks);
}

export async function moveBlock(id: string, blockId: string, dir: number) {
  const page = await getPage(id);
  const blocks = [...page.blocks];
  const i = blocks.findIndex((b) => b.id === blockId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= blocks.length) return;
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  await saveBlocks(id, blocks);
}

export async function deleteBlock(id: string, blockId: string) {
  const page = await getPage(id);
  await saveBlocks(
    id,
    page.blocks.filter((b) => b.id !== blockId),
  );
}

/** Publishing is an outbound action → approval gate. */
export async function requestPublish(id: string) {
  const db = await getDb();
  const page = await getPage(id);
  const [pending] = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.kind, "publish_page"), eq(schema.approvals.subjectId, id), eq(schema.approvals.status, "pending")));
  if (!pending) {
    await createApproval({
      kind: "publish_page",
      title: `Publish page “${page.title}”`,
      summary: `Goes live at ${appUrl()}/p/${page.slug} with ${page.blocks.length} block${page.blocks.length === 1 ? "" : "s"}.`,
      payload: { pageId: id },
      subjectType: "page",
      subjectId: id,
    });
  }
  revalidatePath(`/funnels/pages/${id}`);
}

export async function unpublishPage(id: string) {
  const db = await getDb();
  await db.update(schema.pages).set({ published: false, updatedAt: new Date() }).where(eq(schema.pages.id, id));
  revalidatePath(`/funnels/pages/${id}`);
}

export async function deletePage(id: string) {
  const db = await getDb();
  await db.delete(schema.pages).where(eq(schema.pages.id, id));
  redirect("/funnels");
}

/* ───────────── Forms ───────────── */

export async function createForm(form: FormData) {
  const db = await getDb();
  const [f] = await db
    .insert(schema.forms)
    .values({ name: String(form.get("name") || "New form"), fields: DEFAULT_FORM_FIELDS })
    .returning();
  redirect(`/funnels/forms/${f.id}`);
}

async function getForm(id: string) {
  const db = await getDb();
  const [f] = await db.select().from(schema.forms).where(eq(schema.forms.id, id));
  if (!f) throw new Error("Form not found");
  return f;
}

export async function updateFormSettings(id: string, form: FormData) {
  const db = await getDb();
  const stageId = String(form.get("stageId") || "") || null;
  let pipelineId: string | null = null;
  if (stageId) {
    const [stage] = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.id, stageId));
    pipelineId = stage?.pipelineId ?? null;
  }
  const update: Partial<typeof schema.forms.$inferInsert> = {
    name: String(form.get("name") || "Form"),
    tags: String(form.get("tags") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    relationshipType: String(form.get("relationshipType") || "") || null,
    pipelineId,
    stageId: pipelineId ? stageId : null,
    sequenceId: String(form.get("sequenceId") || "") || null,
    thankYouSlug: String(form.get("thankYouSlug") || "") || null,
  };
  const file = form.get("leadMagnet");
  if (form.get("removeLeadMagnet") === "on") update.leadMagnetFileId = null;
  else if (file instanceof File && file.size > 0) {
    const saved = await putFile(Buffer.from(await file.arrayBuffer()), file.name, file.type || "application/octet-stream");
    update.leadMagnetFileId = saved.id;
  }
  await db.update(schema.forms).set(update).where(eq(schema.forms.id, id));
  revalidatePath(`/funnels/forms/${id}`);
}

async function saveFields(id: string, fields: FormField[]) {
  const db = await getDb();
  await db.update(schema.forms).set({ fields }).where(eq(schema.forms.id, id));
  revalidatePath(`/funnels/forms/${id}`);
}

const FIELD_TYPES = ["text", "email", "tel", "textarea", "select"] as const;

export async function addField(id: string, form: FormData) {
  const f = await getForm(id);
  const label = String(form.get("label") || "New field");
  let key = slugify(label).replace(/-/g, "_") || "field";
  while (f.fields.some((x) => x.key === key)) key += "_2";
  const type = FIELD_TYPES.includes(String(form.get("type")) as (typeof FIELD_TYPES)[number]) ? (String(form.get("type")) as FormField["type"]) : "text";
  await saveFields(id, [...f.fields, { key, label, type, required: form.get("required") === "on" }]);
}

export async function updateField(id: string, key: string, form: FormData) {
  const f = await getForm(id);
  const type = String(form.get("type")) as FormField["type"];
  await saveFields(
    id,
    f.fields.map((x) =>
      x.key === key
        ? {
            ...x,
            label: String(form.get("label") || x.label),
            type: FIELD_TYPES.includes(type as (typeof FIELD_TYPES)[number]) ? type : x.type,
            required: form.get("required") === "on",
            options: String(form.get("options") ?? "")
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : x,
    ),
  );
}

export async function moveField(id: string, key: string, dir: number) {
  const f = await getForm(id);
  const fields = [...f.fields];
  const i = fields.findIndex((x) => x.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= fields.length) return;
  [fields[i], fields[j]] = [fields[j], fields[i]];
  await saveFields(id, fields);
}

export async function deleteField(id: string, key: string) {
  const f = await getForm(id);
  await saveFields(
    id,
    f.fields.filter((x) => x.key !== key),
  );
}

export async function deleteForm(id: string) {
  const db = await getDb();
  await db.delete(schema.forms).where(eq(schema.forms.id, id));
  redirect("/funnels/forms");
}

/* ───────────── Payments ───────────── */

export async function requestPayment(form: FormData) {
  const db = await getDb();
  const contactId = String(form.get("contactId") || "");
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!c) throw new Error("Pick a contact");
  const amountCents = Math.round(Number(form.get("amount") || 0) * 100);
  if (amountCents <= 0) throw new Error("Enter an amount");
  const description = String(form.get("description") || "Payment to A Cup of Compassion");
  const channel = form.get("channel") === "sms" ? "sms" : "email";
  const to = channel === "sms" ? c.phone : c.email;
  if (!to) throw new Error(`${contactName(c)} has no ${channel === "sms" ? "phone" : "email"}`);
  const payment = await createPaymentRequest({ contactId: c.id, amountCents, description });
  const message =
    String(form.get("message") || "").trim() ||
    `Hi ${c.firstName || "friend"}, here is the secure link for ${description} ($${(amountCents / 100).toFixed(2)}). Thank you!`;
  await createApproval({
    kind: "charge",
    title: `Payment request to ${contactName(c)}: $${(amountCents / 100).toFixed(2)}`,
    summary: description,
    payload: { paymentId: payment.id, channel, to, message },
    contactId: c.id,
    subjectType: "payment",
    subjectId: payment.id,
  });
  redirect("/approvals");
}
