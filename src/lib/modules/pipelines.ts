import { and, eq, ilike, max } from "drizzle-orm";
import { getDb, schema } from "../db";
import { emit } from "../events";
import { findOrCreateContact, logActivity } from "../crm";

/**
 * Pipelines and deals, shared by the Pipelines screens, RJ, and the agent
 * doors (MCP + REST) so Claude, ChatGPT, Meta Muse and Hermes build the same
 * records Pamela does by hand.
 */

export const DEFAULT_STAGES = ["New", "In progress", "Won", "Lost"];
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function createPipeline(input: { name: string; businessLine?: string | null; stages?: string[] }) {
  const name = input.name.trim();
  if (!name) throw new Error("A pipeline needs a name.");
  const db = await getDb();
  const stages = (input.stages?.map((s) => s.trim()).filter(Boolean) ?? []).slice(0, 20);
  const [p] = await db.insert(schema.pipelines).values({ name, businessLine: input.businessLine?.trim() || name }).returning();
  const rows = await db
    .insert(schema.pipelineStages)
    .values((stages.length ? stages : DEFAULT_STAGES).map((s, i) => ({ pipelineId: p.id, name: s, position: i, isWon: /won|booked|closed won|paid/i.test(s), isLost: /lost|passed/i.test(s) })))
    .returning();
  return { pipeline: p, stages: rows };
}

/** A pipeline by id or (partial) name. */
export async function findPipeline(ref: string) {
  const db = await getDb();
  const r = ref.trim();
  if (!r) return null;
  if (isUuid(r)) {
    const [p] = await db.select().from(schema.pipelines).where(eq(schema.pipelines.id, r));
    if (p) return p;
  }
  const [exact] = await db.select().from(schema.pipelines).where(ilike(schema.pipelines.name, r));
  if (exact) return exact;
  const [p] = await db.select().from(schema.pipelines).where(ilike(schema.pipelines.name, `%${r}%`));
  return p ?? null;
}

/** A stage of the pipeline by id or (partial) name; the first stage when none is named. */
export async function findStage(pipelineId: string, ref?: string | null) {
  const db = await getDb();
  const stages = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.pipelineId, pipelineId)).orderBy(schema.pipelineStages.position);
  const r = (ref ?? "").trim().toLowerCase();
  if (!r) return stages[0] ?? null;
  return stages.find((s) => s.id === ref) ?? stages.find((s) => s.name.toLowerCase() === r) ?? stages.find((s) => s.name.toLowerCase().includes(r)) ?? null;
}

export async function addStage(pipelineId: string, name: string) {
  const db = await getDb();
  const existing = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.pipelineId, pipelineId));
  const [s] = await db
    .insert(schema.pipelineStages)
    .values({ pipelineId, name: name.trim(), position: existing.length, isWon: /won|booked|closed won|paid/i.test(name), isLost: /lost|passed/i.test(name) })
    .returning();
  return s;
}

export async function createDeal(input: {
  pipelineId: string;
  stageId: string;
  title?: string | null;
  valueCents?: number;
  contactId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
  dueDate?: Date | null;
  by?: string;
}) {
  const db = await getDb();
  const by = input.by ?? "pipelines";
  const [stage] = await db.select().from(schema.pipelineStages).where(and(eq(schema.pipelineStages.id, input.stageId), eq(schema.pipelineStages.pipelineId, input.pipelineId)));
  if (!stage) throw new Error("That stage isn't in this pipeline.");
  let contactId = input.contactId || null;
  const name = input.contactName?.trim() ?? "";
  const email = input.contactEmail?.trim() ?? "";
  if (!contactId && (name || email)) {
    const { contact, created } = await findOrCreateContact({ name, email: email || null, source: by === "pipelines" ? "pipeline" : by });
    contactId = contact.id;
    if (created) await emit("contact.created", { contactId, source: by }, by);
  }
  const [{ value }] = await db.select({ value: max(schema.deals.position) }).from(schema.deals).where(eq(schema.deals.stageId, stage.id));
  const [deal] = await db
    .insert(schema.deals)
    .values({
      pipelineId: input.pipelineId,
      stageId: stage.id,
      contactId,
      title: input.title?.trim() || name || "New deal",
      valueCents: Math.max(0, Math.round(input.valueCents ?? 0)),
      status: stage.isWon ? "won" : stage.isLost ? "lost" : "open",
      position: (value ?? 0) + 1,
      notes: input.notes?.trim() || null,
      dueDate: input.dueDate ?? null,
    })
    .returning();
  await logActivity({ type: "system", contactId, dealId: deal.id, title: `Deal created: ${deal.title}${by === "pipelines" ? "" : ` (by ${by})`}` });
  await emit("deal.created", { dealId: deal.id, pipelineId: input.pipelineId, contactId }, by);
  return { deal, stage };
}
