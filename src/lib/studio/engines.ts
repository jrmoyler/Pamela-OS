import crypto from "node:crypto";
import { getSecret, getSetting } from "../settings";
import { aspectSize, type Capability } from "./graph";

/**
 * Engines that run the open-source models behind the Create studio. Each is
 * called server-side; results are downloaded into Pamela OS storage, so the UI
 * never sends her anywhere else.
 *
 *  - ComfyUI: her own GPU box (VPS or desktop) running any open model. Text-to-image
 *    works out of the box; other capabilities use a workflow she pastes in Studio → Engines.
 *  - Replicate and fal: hosted copies of the same open models (FLUX, Wan, LTX-Video,
 *    Real-ESRGAN, BiRefNet), paid per run, nothing to install.
 */
export type EngineId = "comfyui" | "replicate" | "fal";

export const ENGINE_LABELS: Record<EngineId, string> = { comfyui: "ComfyUI (self-hosted)", replicate: "Replicate", fal: "fal" };

export const CAPABILITY_LABELS: Record<Capability, string> = {
  image: "Text → image",
  edit: "Image edit",
  upscale: "Upscale",
  remove_bg: "Remove background",
  video_i2v: "Image → video",
  video_t2v: "Text → video",
};

/** Default open models per engine. Any of them can be swapped in Studio → Engines. */
export const DEFAULT_MODELS: Record<Exclude<EngineId, "comfyui">, Record<Capability, string>> = {
  replicate: {
    image: "black-forest-labs/flux-schnell",
    edit: "black-forest-labs/flux-kontext-dev",
    upscale: "nightmareai/real-esrgan",
    remove_bg: "851-labs/background-remover",
    video_i2v: "wan-video/wan-2.2-i2v-fast",
    video_t2v: "wan-video/wan-2.2-t2v-fast",
  },
  fal: {
    image: "fal-ai/flux/schnell",
    edit: "fal-ai/flux-kontext/dev",
    upscale: "fal-ai/esrgan",
    remove_bg: "fal-ai/birefnet",
    video_i2v: "fal-ai/wan-i2v",
    video_t2v: "fal-ai/wan-t2v",
  },
};

export type Media = { data: Buffer; mime: string; name: string };
export type EngineRequest = {
  capability: Capability;
  prompt: string;
  images: Media[]; // first is the subject / start frame
  aspect: string;
  count: number;
  scale: number;
  model?: string;
};
export type EngineResult = { engine: EngineId; model: string; outputs: Media[] };

async function engineConfigured(id: EngineId) {
  if (id === "comfyui") return !!(await getSecret("COMFYUI_URL"));
  if (id === "replicate") return !!(await getSecret("REPLICATE_API_TOKEN"));
  return !!(await getSecret("FAL_KEY"));
}

/** Engines that can do this capability right now, in the order "auto" tries them. */
export async function enginesFor(cap: Capability): Promise<EngineId[]> {
  const studio = await getSetting("studio");
  const out: EngineId[] = [];
  if ((await engineConfigured("comfyui")) && (cap === "image" || studio.comfyWorkflows[cap]?.trim())) out.push("comfyui");
  if (await engineConfigured("replicate")) out.push("replicate");
  if (await engineConfigured("fal")) out.push("fal");
  return out;
}

export async function engineStatus() {
  const caps = Object.keys(CAPABILITY_LABELS) as Capability[];
  return {
    engines: Object.fromEntries(await Promise.all((Object.keys(ENGINE_LABELS) as EngineId[]).map(async (e) => [e, await engineConfigured(e)]))) as Record<EngineId, boolean>,
    capabilities: Object.fromEntries(await Promise.all(caps.map(async (c) => [c, await enginesFor(c)]))) as Record<Capability, EngineId[]>,
  };
}

export class NoEngineError extends Error {
  constructor(cap: Capability) {
    super(`No engine can do “${CAPABILITY_LABELS[cap]}” yet. Connect ComfyUI, Replicate or fal in Settings → Connections (Generative studio).`);
  }
}

/** Runs one generation on the chosen engine (or the first available one when "auto"). */
export async function generate(req: EngineRequest, preferred: EngineId | "auto" = "auto"): Promise<EngineResult> {
  const studio = await getSetting("studio");
  const available = await enginesFor(req.capability);
  const pick = preferred !== "auto" ? preferred : (studio.engines[req.capability] ?? "auto");
  const engine = pick !== "auto" && available.includes(pick) ? pick : available[0];
  if (!engine) throw new NoEngineError(req.capability);
  if (pick !== "auto" && engine !== pick) throw new Error(`${ENGINE_LABELS[pick]} can't do “${CAPABILITY_LABELS[req.capability]}” until it's connected${pick === "comfyui" ? " and has a workflow in Studio → Engines" : ""}.`);
  if (engine === "comfyui") return runComfy(req, studio.comfyWorkflows[req.capability]);
  const model = req.model?.trim() || studio.models[`${engine}:${req.capability}`]?.trim() || DEFAULT_MODELS[engine][req.capability];
  return engine === "replicate" ? runReplicate(req, model) : runFal(req, model);
}

/* ───────────── helpers ───────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const extOf = (mime: string) => (mime.split("/")[1] || "bin").replace("jpeg", "jpg").replace("quicktime", "mov").replace(/[^a-z0-9]/g, "").slice(0, 5);

async function download(url: string, fallbackMime: string, headers: Record<string, string> = {}): Promise<Media> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Could not download the result (${res.status}).`);
  const mime = (res.headers.get("content-type") || fallbackMime).split(";")[0];
  return { data: Buffer.from(await res.arrayBuffer()), mime, name: `studio-${crypto.randomUUID().slice(0, 8)}.${extOf(mime)}` };
}

const dataUri = (m: Media) => `data:${m.mime};base64,${m.data.toString("base64")}`;
const isVideoCap = (cap: Capability) => cap === "video_i2v" || cap === "video_t2v";

/** Collects every URL-looking string in a model's output (string, array, or nested object). */
export function urlsIn(output: unknown): string[] {
  if (typeof output === "string") return /^(https?:|data:)/.test(output) ? [output] : [];
  if (Array.isArray(output)) return output.flatMap(urlsIn);
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.url === "string") return [o.url];
    return ["images", "image", "video", "videos", "output", "file", "audio"].flatMap((k) => (k in o ? urlsIn(o[k]) : []));
  }
  return [];
}

/* ───────────── Replicate ───────────── */

const REPLICATE = "https://api.replicate.com/v1";

async function replicateUpload(token: string, m: Media): Promise<string> {
  const form = new FormData();
  form.append("content", new Blob([new Uint8Array(m.data)], { type: m.mime }), m.name);
  const res = await fetch(`${REPLICATE}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.urls?.get) throw new Error(`Replicate upload ${res.status}: ${data?.detail ?? "failed"}`);
  return data.urls.get;
}

function replicateInput(req: EngineRequest, imageUrl: string | undefined): Record<string, unknown> {
  switch (req.capability) {
    case "image":
      return { prompt: req.prompt, aspect_ratio: req.aspect, num_outputs: req.count, output_format: "png" };
    case "edit":
      return { prompt: req.prompt, input_image: imageUrl, aspect_ratio: "match_input_image", output_format: "png" };
    case "upscale":
      return { image: imageUrl, scale: req.scale };
    case "remove_bg":
      return { image: imageUrl };
    case "video_i2v":
      return { prompt: req.prompt, image: imageUrl };
    case "video_t2v":
      return { prompt: req.prompt, aspect_ratio: req.aspect };
  }
}

async function runReplicate(req: EngineRequest, model: string): Promise<EngineResult> {
  const token = await getSecret("REPLICATE_API_TOKEN");
  if (!token) throw new Error("Replicate isn't connected.");
  const imageUrl = req.images[0] ? await replicateUpload(token, req.images[0]) : undefined;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "wait=55" };
  // "owner/name" runs the model's latest version; "owner/name:version" pins one.
  const res = await fetch(`${REPLICATE}/predictions`, { method: "POST", headers, body: JSON.stringify({ version: model, input: replicateInput(req, imageUrl) }), signal: AbortSignal.timeout(90_000) });
  let pred = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${pred?.detail ?? pred?.title ?? "request failed"}`);
  const deadline = Date.now() + (isVideoCap(req.capability) ? 12 : 4) * 60_000;
  while (pred.status !== "succeeded") {
    if (pred.status === "failed" || pred.status === "canceled") throw new Error(`Replicate: ${pred.error || pred.status}`);
    if (Date.now() > deadline) throw new Error("Replicate is still working. Run the node again in a minute to pick it up.");
    await sleep(3000);
    const r = await fetch(pred.urls?.get ?? `${REPLICATE}/predictions/${pred.id}`, { headers: { authorization: `Bearer ${token}` } });
    pred = await r.json();
  }
  const urls = urlsIn(pred.output);
  if (!urls.length) throw new Error("Replicate finished but returned no files.");
  const fallback = isVideoCap(req.capability) ? "video/mp4" : "image/png";
  return { engine: "replicate", model, outputs: await Promise.all(urls.map((u) => download(u, fallback))) };
}

/* ───────────── fal ───────────── */

const FAL_SIZES: Record<string, string> = { "1:1": "square_hd", "4:3": "landscape_4_3", "16:9": "landscape_16_9", "3:4": "portrait_4_3", "4:5": "portrait_4_3", "9:16": "portrait_16_9" };

function falInput(req: EngineRequest): Record<string, unknown> {
  const image_url = req.images[0] ? dataUri(req.images[0]) : undefined;
  switch (req.capability) {
    case "image":
      return { prompt: req.prompt, image_size: FAL_SIZES[req.aspect] ?? "square_hd", num_images: req.count };
    case "edit":
      return { prompt: req.prompt, image_url };
    case "upscale":
      return { image_url, scale: req.scale };
    case "remove_bg":
      return { image_url };
    case "video_i2v":
      return { prompt: req.prompt, image_url };
    case "video_t2v":
      return { prompt: req.prompt, aspect_ratio: req.aspect === "9:16" || req.aspect === "16:9" ? req.aspect : "16:9" };
  }
}

async function runFal(req: EngineRequest, model: string): Promise<EngineResult> {
  const key = await getSecret("FAL_KEY");
  if (!key) throw new Error("fal isn't connected.");
  const headers = { authorization: `Key ${key}`, "content-type": "application/json" };
  const res = await fetch(`https://queue.fal.run/${model.replace(/^\/+/, "")}`, { method: "POST", headers, body: JSON.stringify(falInput(req)), signal: AbortSignal.timeout(90_000) });
  const job = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`fal ${res.status}: ${job?.detail?.[0]?.msg ?? job?.detail ?? "request failed"}`);
  const deadline = Date.now() + (isVideoCap(req.capability) ? 12 : 4) * 60_000;
  for (;;) {
    const s = await fetch(job.status_url, { headers }).then((r) => r.json());
    if (s.status === "COMPLETED") break;
    if (s.status === "FAILED" || s.error) throw new Error(`fal: ${s.error ?? "generation failed"}`);
    if (Date.now() > deadline) throw new Error("fal is still working. Run the node again in a minute.");
    await sleep(2500);
  }
  const result = await fetch(job.response_url, { headers }).then((r) => r.json());
  const urls = urlsIn(result);
  if (!urls.length) throw new Error(`fal finished but returned no files${result?.detail ? `: ${JSON.stringify(result.detail).slice(0, 200)}` : "."}`);
  const fallback = isVideoCap(req.capability) ? "video/mp4" : "image/png";
  return { engine: "fal", model, outputs: await Promise.all(urls.map((u) => download(u, fallback))) };
}

/* ───────────── ComfyUI ───────────── */

/** Built-in text-to-image workflow (API format). {{checkpoint}} comes from Settings; works with SDXL or FLUX all-in-one checkpoints. */
export const DEFAULT_COMFY_T2I = {
  "3": { class_type: "KSampler", inputs: { seed: "{{seed}}", steps: 28, cfg: 6, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{checkpoint}}" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: "{{width}}", height: "{{height}}", batch_size: "{{count}}" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "{{negative}}", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "pamela-os", images: ["8", 0] } },
};

/**
 * Fills {{placeholders}} in a workflow. A string that is exactly one placeholder
 * becomes the typed value (so "{{seed}}" turns into a number); otherwise it is
 * interpolated as text.
 */
export function fillWorkflow(node: unknown, vars: Record<string, string | number>): unknown {
  if (typeof node === "string") {
    const whole = node.match(/^\{\{\s*(\w+)\s*\}\}$/);
    if (whole && whole[1] in vars) return vars[whole[1]];
    return node.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  if (Array.isArray(node)) return node.map((x) => fillWorkflow(x, vars));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillWorkflow(v, vars)]));
  return node;
}

type ComfyFile = { filename: string; subfolder?: string; type?: string };

async function runComfy(req: EngineRequest, customWorkflow?: string): Promise<EngineResult> {
  const base = (await getSecret("COMFYUI_URL"))?.replace(/\/+$/, "");
  if (!base) throw new Error("ComfyUI isn't connected.");
  const key = await getSecret("COMFYUI_API_KEY");
  const auth: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
  let template: unknown = DEFAULT_COMFY_T2I;
  if (customWorkflow?.trim()) {
    try {
      template = JSON.parse(customWorkflow);
    } catch {
      throw new Error(`The ComfyUI workflow for “${CAPABILITY_LABELS[req.capability]}” isn't valid JSON. Export it with “Save (API format)”.`);
    }
  }
  const uploaded: string[] = [];
  for (const img of req.images) {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(img.data)], { type: img.mime }), img.name);
    form.append("overwrite", "true");
    const r = await fetch(`${base}/upload/image`, { method: "POST", headers: auth, body: form });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d?.name) throw new Error(`ComfyUI image upload ${r.status}`);
    uploaded.push(d.subfolder ? `${d.subfolder}/${d.name}` : d.name);
  }
  const { width, height } = aspectSize(req.aspect);
  const vars = {
    prompt: req.prompt,
    negative: "text, watermark, logo, lettering, blurry, distorted hands, extra fingers",
    seed: Math.floor(Math.random() * 2 ** 31),
    width,
    height,
    count: req.count,
    scale: req.scale,
    image: uploaded[0] ?? "",
    image2: uploaded[1] ?? uploaded[0] ?? "",
    checkpoint: (await getSecret("COMFYUI_CHECKPOINT")) || "sd_xl_base_1.0.safetensors",
  };
  const res = await fetch(`${base}/prompt`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ prompt: fillWorkflow(template, vars), client_id: "pamela-os" }),
  });
  const queued = await res.json().catch(() => ({}));
  if (!res.ok || !queued?.prompt_id) throw new Error(`ComfyUI ${res.status}: ${JSON.stringify(queued?.node_errors ?? queued?.error ?? queued).slice(0, 300)}`);
  const deadline = Date.now() + (isVideoCap(req.capability) ? 20 : 8) * 60_000;
  let files: ComfyFile[] = [];
  for (;;) {
    const h = await fetch(`${base}/history/${queued.prompt_id}`, { headers: auth }).then((r) => r.json()).catch(() => ({}));
    const entry = h?.[queued.prompt_id];
    if (entry?.status?.status_str === "error") throw new Error("ComfyUI reported an error running the workflow. Check its console.");
    if (entry?.outputs) {
      files = Object.values(entry.outputs as Record<string, Record<string, ComfyFile[]>>).flatMap((o) => [...(o.images ?? []), ...(o.gifs ?? []), ...(o.videos ?? [])]).filter((f) => f.type !== "temp");
      if (files.length || entry.status?.completed) break;
    }
    if (Date.now() > deadline) throw new Error("ComfyUI is still working. Run the node again when it's done.");
    await sleep(2000);
  }
  if (!files.length) throw new Error("ComfyUI finished but the workflow saved no files. End it with a Save Image or Save Video node.");
  const outputs = await Promise.all(
    files.map((f) => download(`${base}/view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type ?? "output" })}`, isVideoCap(req.capability) ? "video/mp4" : "image/png", auth)),
  );
  return { engine: "comfyui", model: customWorkflow?.trim() ? "custom workflow" : String(vars.checkpoint), outputs };
}
