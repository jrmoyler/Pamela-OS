import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { getSetting } from "../settings";
import { putFile, readFile } from "../storage";
import { enqueue } from "../jobs";
import { aiText } from "../ai";
import { speakWithClone } from "../modules/voice";
import { TEMPLATES } from "@/components/studio/designTemplates";
import { generate, type EngineId, type Media } from "./engines";
import { NODE_DEFS, capabilityFor, composePrompt, normalizeGraph, sourcesOf, topoOrder, type FlowGraph, type FlowNode, type BrandStyle } from "./graph";

/**
 * Runs canvas nodes. Each run is a studio_generations row; a "studio.run" job
 * works through a list of them in order, so a downstream node always sees the
 * fresh output of the node feeding it.
 */
type Generation = typeof schema.studioGenerations.$inferSelect;

export async function loadFlow(flowId: string) {
  const db = await getDb();
  const [flow] = await db.select().from(schema.studioFlows).where(eq(schema.studioFlows.id, flowId));
  if (!flow) throw new Error("Canvas not found.");
  return { ...flow, graph: normalizeGraph(flow.graph) };
}

/** Latest finished run per node: what that node currently "outputs" on its wires. */
async function latestDone(flowId: string): Promise<Map<string, Generation>> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.studioGenerations)
    .where(and(eq(schema.studioGenerations.flowId, flowId), eq(schema.studioGenerations.status, "done")))
    .orderBy(desc(schema.studioGenerations.createdAt));
  const out = new Map<string, Generation>();
  for (const r of rows) if (!out.has(r.nodeId)) out.set(r.nodeId, r);
  return out;
}

/** The file a node hands downstream: the output she picked on the node, or its first one. */
function outputFile(node: FlowNode, latest: Map<string, Generation>): string | null {
  if (node.type === "image") return (node.data.fileId as string) || null;
  const g = latest.get(node.id);
  if (!g?.outputFileIds.length) return null;
  const pick = Number(node.data.pick ?? 0);
  return g.outputFileIds[pick] ?? g.outputFileIds[0];
}

type Inputs = { texts: string[]; image: string | null; video: string | null; brand: FlowNode | null; missing: string[] };

function resolveInputs(graph: FlowGraph, node: FlowNode, latest: Map<string, Generation>): Inputs {
  const res: Inputs = { texts: [], image: null, video: null, brand: null, missing: [] };
  for (const port of NODE_DEFS[node.type].inputs) {
    for (const { node: src } of sourcesOf(graph, node.id, port.id)) {
      if (port.type === "text") {
        const t = String(src.data.text ?? "").trim();
        if (t) res.texts.push(t);
      } else if (port.type === "brand") res.brand = src;
      else {
        const f = outputFile(src, latest);
        if (!f) res.missing.push(src.type === "image" ? "Pick a photo in the Image node" : `Run ${NODE_DEFS[src.type].label}`);
        else if (port.type === "image") res.image ??= f;
        else if (port.type === "video") res.video ??= f;
      }
    }
  }
  return res;
}

async function media(fileId: string, kind: "image" | "video"): Promise<Media> {
  const f = await readFile(fileId);
  if (!f) throw new Error("An input file is missing from the Library.");
  if (!f.mime.startsWith(`${kind}/`)) throw new Error(`Expected ${kind === "image" ? "an image" : "a video"} but got ${f.name}.`);
  return f;
}

/** Turns her plain words into a richer prompt for image/video models, when an AI model is connected. */
async function enhancePrompt(prompt: string, kind: "image" | "video") {
  const r = await aiText(
    "drafting",
    `You write prompts for open-source ${kind} generation models (FLUX, Wan). Keep the user's subject and intent exactly. Add concrete detail about subject, setting, lighting, lens and mood. Keep any brand art direction given. One paragraph, under 90 words. Never add text, captions or logos to the scene. Return only the prompt.`,
    prompt,
    300,
  ).catch(() => null);
  return r?.text.trim() || prompt;
}

async function brandStyle(): Promise<BrandStyle> {
  const kit = await getSetting("brandKit");
  return { name: kit.name, tagline: kit.tagline, visualStyle: kit.visualStyle };
}

const label = (node: FlowNode) => NODE_DEFS[node.type].label;

async function execute(gen: Generation, graph: FlowGraph, latest: Map<string, Generation>) {
  const node = graph.nodes.find((n) => n.id === gen.nodeId);
  if (!node) throw new Error("This node was deleted from the canvas.");
  const inp = resolveInputs(graph, node, latest);
  if (inp.missing.length) throw new Error(`${[...new Set(inp.missing)].join(", ")} first: ${label(node)} needs its output.`);
  const db = await getDb();

  if (node.type === "voice") {
    const script = [String(node.data.script ?? ""), ...inp.texts].map((s) => s.trim()).filter(Boolean).join("\n\n");
    if (!script) throw new Error("Write a script, or wire a Prompt into the Script slot.");
    let cloneId = String(node.data.cloneId || "");
    if (!cloneId) {
      const [ready] = await db.select().from(schema.voiceClones).where(eq(schema.voiceClones.status, "ready")).limit(1);
      if (!ready) throw new Error("No voice is ready yet. Create Pamela's voice in Studios → Her voice first.");
      cloneId = ready.id;
    }
    const audio = await speakWithClone(cloneId, script);
    const file = await putFile(audio.data, `voice-${gen.id.slice(0, 8)}.${audio.ext}`, audio.mime, { source: "studio", description: script.slice(0, 300), tags: ["studio", "voice"] });
    return { provider: audio.provider, model: "voice clone", prompt: script, inputFileIds: [], outputFileIds: [file.id], params: { cloneId } };
  }

  if (node.type === "design") {
    const t = TEMPLATES.find((x) => x.key === node.data.templateKey) ?? TEMPLATES[1];
    const headline = String(node.data.headline || inp.texts[0] || "").trim();
    const fields: Record<string, string> = { headline, body: String(node.data.body ?? ""), cta: String(node.data.cta ?? "") };
    if (inp.image && t.fields.includes("photo")) {
      await media(inp.image, "image");
      fields.photoFileId = inp.image;
    }
    const [design] = await db.insert(schema.designs).values({ title: headline || `${t.name} from Create`, templateKey: t.key, format: t.format, fields }).returning();
    return { provider: "pamela", model: t.name, prompt: headline, inputFileIds: inp.image ? [inp.image] : [], outputFileIds: [], params: { designId: design.id } };
  }

  if (node.type === "clips") {
    if (!inp.video) throw new Error("Wire a video into Make clips.");
    const rec = await db.select().from(schema.files).where(eq(schema.files.id, inp.video)).then((r) => r[0]);
    const [video] = await db.insert(schema.videos).values({ title: rec?.name.replace(/\.[^.]+$/, "") || "Studio video", sourceFileId: inp.video, status: "processing" }).returning();
    await enqueue("video.process", { videoId: video.id });
    return { provider: "pamela", model: "clip studio", prompt: null, inputFileIds: [inp.video], outputFileIds: [], params: { videoId: video.id } };
  }

  // Engine nodes. A Brand kit with picked assets lends its first asset as the reference image.
  const brandAssets = ((inp.brand?.data.assetFileIds as string[] | undefined) ?? []).filter(Boolean);
  const subject = inp.image ?? (node.type === "generate_image" && brandAssets[0] ? brandAssets[0] : null);
  const cap = capabilityFor(node.type, !!subject)!;
  const kind = cap.startsWith("video") ? "video" : "image";
  const style = inp.brand && inp.brand.data.style !== false ? await brandStyle() : null;
  const needsPrompt = cap === "image" || cap === "edit" || cap === "video_t2v";
  let prompt = "";
  if (cap !== "upscale" && cap !== "remove_bg") {
    const words = [String(node.data.prompt ?? ""), ...inp.texts].filter((s) => s.trim());
    if (needsPrompt && !words.length) throw new Error(`Write a prompt on ${label(node)}, or wire a Prompt node into it.`);
    prompt = composePrompt(words, style, kind);
    if (node.data.enhance && cap !== "edit") prompt = await enhancePrompt(prompt, kind);
  }
  if ((cap === "edit" || cap === "upscale" || cap === "remove_bg" || cap === "video_i2v") && !subject) throw new Error(`Wire an image into ${label(node)}.`);
  const images = subject ? [await media(subject, "image")] : [];
  const result = await generate(
    {
      capability: cap,
      prompt,
      images,
      aspect: String(node.data.aspect || "1:1"),
      count: Math.min(4, Math.max(1, Number(node.data.count) || 1)),
      scale: Number(node.data.scale) === 4 ? 4 : 2,
      model: String(node.data.model || ""),
    },
    (String(node.data.engine || "auto") as EngineId | "auto"),
  );
  const saved = [];
  for (const [i, out] of result.outputs.entries()) {
    const name = `${cap.replace("_", "-")}-${gen.id.slice(0, 8)}${result.outputs.length > 1 ? `-${i + 1}` : ""}.${out.name.split(".").pop()}`;
    saved.push(await putFile(out.data, name, out.mime, { source: "studio", sourceRef: `${result.engine}:${result.model}`, description: prompt.slice(0, 500) || null, tags: ["studio", cap] }));
  }
  return { provider: result.engine, model: result.model, prompt, inputFileIds: subject ? [subject] : [], outputFileIds: saved.map((f) => f.id), params: { capability: cap } };
}

/** Job handler: runs the listed generations in order, skipping what depends on a failure. */
export async function runGenerationsJob(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ids = (payload.generationIds as string[]) ?? [];
  const db = await getDb();
  const failedNodes = new Set<string>();
  const done: string[] = [];
  for (const id of ids) {
    const [gen] = await db.select().from(schema.studioGenerations).where(eq(schema.studioGenerations.id, id));
    if (!gen || gen.status === "done" || gen.status === "failed") continue;
    try {
      const flow = await loadFlow(gen.flowId!);
      const upstreamFailed = flow.graph.edges.some((e) => e.to === gen.nodeId && failedNodes.has(e.from));
      if (upstreamFailed) throw new Error("Skipped: a node feeding this one failed.");
      await db.update(schema.studioGenerations).set({ status: "running" }).where(eq(schema.studioGenerations.id, id));
      const r = await execute(gen, flow.graph, await latestDone(flow.id));
      await db
        .update(schema.studioGenerations)
        .set({ ...r, params: { ...gen.params, ...r.params }, status: "done", error: null, finishedAt: new Date() })
        .where(eq(schema.studioGenerations.id, id));
      const firstImage = r.outputFileIds[0] && !flow.coverFileId && (r.params as { capability?: string }).capability?.match(/^(image|edit|upscale|remove_bg)$/);
      await db.update(schema.studioFlows).set({ updatedAt: new Date(), ...(firstImage ? { coverFileId: r.outputFileIds[0] } : {}) }).where(eq(schema.studioFlows.id, flow.id));
      done.push(id);
    } catch (e) {
      failedNodes.add(gen.nodeId);
      await db.update(schema.studioGenerations).set({ status: "failed", error: (e as Error).message, finishedAt: new Date() }).where(eq(schema.studioGenerations.id, id));
    }
  }
  // Failures are recorded on each node; the job itself succeeded so it isn't retried (engines bill per run).
  return { done, failed: [...failedNodes] };
}

/**
 * Queues nodes to run (plus nothing else: upstream nodes are used as they are).
 * Nodes already queued or running are left alone, so a double-click doesn't pay twice.
 */
export async function queueNodes(flowId: string, nodeIds: string[]) {
  const flow = await loadFlow(flowId);
  const db = await getDb();
  const active = await db
    .select({ nodeId: schema.studioGenerations.nodeId })
    .from(schema.studioGenerations)
    .where(and(eq(schema.studioGenerations.flowId, flowId), inArray(schema.studioGenerations.status, ["queued", "running"])));
  const busy = new Set(active.map((a) => a.nodeId));
  const order = topoOrder(flow.graph).filter((n) => nodeIds.includes(n.id) && NODE_DEFS[n.type].runnable && !busy.has(n.id));
  if (!order.length) return [];
  const rows = await db
    .insert(schema.studioGenerations)
    .values(order.map((n) => ({ flowId, nodeId: n.id, kind: n.type, status: "queued" })))
    .returning();
  const ids = order.map((n) => rows.find((r) => r.nodeId === n.id)!.id);
  await enqueue("studio.run", { generationIds: ids });
  return ids;
}

/** Every runnable node, in order: the canvas's "Run all". */
export async function queueFlow(flowId: string) {
  const flow = await loadFlow(flowId);
  return queueNodes(flowId, flow.graph.nodes.map((n) => n.id));
}
