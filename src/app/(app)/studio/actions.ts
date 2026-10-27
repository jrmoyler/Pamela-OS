"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { requireSession } from "@/lib/auth";
import { STARTERS, normalizeGraph, type Capability, type FlowGraph } from "@/lib/studio/graph";
import { CAPABILITY_LABELS } from "@/lib/studio/engines";
import { queueFlow, queueNodes } from "@/lib/studio/run";

export async function createFlow(form: FormData) {
  await requireSession();
  const starter = STARTERS.find((s) => s.key === form.get("starter")) ?? STARTERS[0];
  const db = await getDb();
  const [flow] = await db
    .insert(schema.studioFlows)
    .values({ title: String(form.get("title") || "").trim() || (starter.key === "blank" ? "Untitled canvas" : starter.title), graph: starter.build() })
    .returning();
  redirect(`/studio/create/${flow.id}`);
}

export async function saveFlow(id: string, title: string, graph: FlowGraph) {
  await requireSession();
  const db = await getDb();
  await db
    .update(schema.studioFlows)
    .set({ title: title.trim().slice(0, 120) || "Untitled canvas", graph: normalizeGraph(graph), updatedAt: new Date() })
    .where(eq(schema.studioFlows.id, id));
}

/** Saves the canvas as she sees it, then queues the nodes (all runnable ones when nodeIds is null). */
export async function runNodes(id: string, title: string, graph: FlowGraph, nodeIds: string[] | null) {
  await saveFlow(id, title, graph);
  const queued = nodeIds ? await queueNodes(id, nodeIds) : await queueFlow(id);
  return { queued: queued.length };
}

export async function deleteFlow(id: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.studioFlows).where(eq(schema.studioFlows.id, id));
  redirect("/studio");
}

export async function duplicateFlow(id: string) {
  await requireSession();
  const db = await getDb();
  const [flow] = await db.select().from(schema.studioFlows).where(eq(schema.studioFlows.id, id));
  if (!flow) throw new Error("Canvas not found.");
  const [copy] = await db.insert(schema.studioFlows).values({ title: `${flow.title} (copy)`, graph: flow.graph, coverFileId: flow.coverFileId }).returning();
  redirect(`/studio/create/${copy.id}`);
}

export async function saveEngines(form: FormData) {
  await requireSession();
  const current = await getSetting("studio");
  const engines: Record<string, "auto" | "comfyui" | "replicate" | "fal"> = {};
  const models: Record<string, string> = {};
  const comfyWorkflows: Record<string, string> = {};
  for (const cap of Object.keys(CAPABILITY_LABELS) as Capability[]) {
    const e = String(form.get(`engine:${cap}`) || "auto");
    engines[cap] = e === "comfyui" || e === "replicate" || e === "fal" ? e : "auto";
    for (const host of ["replicate", "fal"]) {
      const m = String(form.get(`model:${host}:${cap}`) ?? "").trim();
      if (m) models[`${host}:${cap}`] = m;
    }
    const wf = String(form.get(`comfy:${cap}`) ?? "").trim();
    if (wf) {
      try {
        JSON.parse(wf);
      } catch {
        throw new Error(`The ComfyUI workflow for “${CAPABILITY_LABELS[cap]}” isn't valid JSON. In ComfyUI use Workflow → Export (API).`);
      }
      comfyWorkflows[cap] = wf;
    }
  }
  await setSetting("studio", { ...current, engines, models, comfyWorkflows });
  revalidatePath("/studio/engines");
  revalidatePath("/studio");
}
