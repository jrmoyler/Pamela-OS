"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { emit } from "@/lib/events";
import { logActivity } from "@/lib/crm";
import { addStage as addStageRecord, createDeal as createDealRecord, createPipeline as createPipelineRecord, DEFAULT_STAGES } from "@/lib/modules/pipelines";
import { requireSession } from "@/lib/auth";

export async function moveDeal(dealId: string, stageId: string, position: number) {
  await requireSession();
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
  await requireSession();
  const stageId = String(form.get("stageId") || "");
  if (!stageId) return; // pipeline has no stages yet
  const name = String(form.get("contact") ?? "").trim();
  await createDealRecord({
    pipelineId,
    stageId,
    title: String(form.get("title") || "") || null,
    valueCents: Number(form.get("value") || 0) * 100,
    contactId: String(form.get("contactId") || "") || null,
    contactName: name,
    contactEmail: String(form.get("email") ?? ""),
  });
  revalidatePath(`/pipelines/${pipelineId}`);
}

export async function createPipeline(form: FormData) {
  await requireSession();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  const { pipeline } = await createPipelineRecord({
    name,
    businessLine: String(form.get("businessLine") || "") || null,
    stages: String(form.get("stages") || DEFAULT_STAGES.join(", ")).split(","),
  });
  redirect(`/pipelines/${pipeline.id}`);
}

export async function addStage(pipelineId: string, form: FormData) {
  await requireSession();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  await addStageRecord(pipelineId, name);
  revalidatePath(`/pipelines/${pipelineId}`);
}
