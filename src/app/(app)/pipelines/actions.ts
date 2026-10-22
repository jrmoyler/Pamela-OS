"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asc, eq, max } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { emit } from "@/lib/events";
import { logActivity, findOrCreateContact } from "@/lib/crm";

export async function moveDeal(dealId: string, stageId: string, position: number) {
  const db = await getDb();
  const [stage] = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.id, stageId));
  if (!stage) return;
  const [before] = await db.select().from(schema.deals).where(eq(schema.deals.id, dealId));
  const [deal] = await db
    .update(schema.deals)
    .set({ stageId, position, status: stage.isWon ? "won" : stage.isLost ? "lost" : "open", updatedAt: new Date() })
    .where(eq(schema.deals.id, dealId))
    .returning();
  if (deal && before?.stageId !== stageId) {
    await logActivity({ type: "system", contactId: deal.contactId, dealId: deal.id, title: `“${deal.title}” moved to ${stage.name}` });
    await emit("deal.stage_changed", { dealId: deal.id, pipelineId: deal.pipelineId, stageName: stage.name, contactId: deal.contactId }, "pipelines");
  }
  revalidatePath(`/pipelines/${stage.pipelineId}`);
}

export async function createDeal(pipelineId: string, form: FormData) {
  const db = await getDb();
  const stageId = String(form.get("stageId"));
  const name = String(form.get("contact") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  let contactId: string | null = String(form.get("contactId") || "") || null;
  if (!contactId && (name || email)) {
    const { contact, created } = await findOrCreateContact({ name, email: email || null, source: "pipeline" });
    contactId = contact.id;
    if (created) await emit("contact.created", { contactId, source: "pipeline" }, "pipelines");
  }
  const [{ value }] = await db.select({ value: max(schema.deals.position) }).from(schema.deals).where(eq(schema.deals.stageId, stageId));
  const [deal] = await db
    .insert(schema.deals)
    .values({
      pipelineId,
      stageId,
      contactId,
      title: String(form.get("title") || name || "New deal"),
      valueCents: Math.round(Number(form.get("value") || 0) * 100),
      position: (value ?? 0) + 1,
    })
    .returning();
  await logActivity({ type: "system", contactId, dealId: deal.id, title: `Deal created: ${deal.title}` });
  await emit("deal.created", { dealId: deal.id, pipelineId, contactId }, "pipelines");
  revalidatePath(`/pipelines/${pipelineId}`);
}

export async function createPipeline(form: FormData) {
  const db = await getDb();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  const [p] = await db.insert(schema.pipelines).values({ name, businessLine: String(form.get("businessLine") || name) }).returning();
  const stages = String(form.get("stages") || "New, In progress, Won, Lost")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  await db.insert(schema.pipelineStages).values(stages.map((s, i) => ({ pipelineId: p.id, name: s, position: i, isWon: /won|booked|closed won|paid/i.test(s), isLost: /lost|passed/i.test(s) })));
  redirect(`/pipelines/${p.id}`);
}

export async function addStage(pipelineId: string, form: FormData) {
  const db = await getDb();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  const existing = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.pipelineId, pipelineId)).orderBy(asc(schema.pipelineStages.position));
  await db.insert(schema.pipelineStages).values({ pipelineId, name, position: existing.length });
  revalidatePath(`/pipelines/${pipelineId}`);
}
