/**
 * The Create studio's node graph. Pure data + functions, shared by the canvas
 * in the browser and the runner on the server (no imports from db or storage).
 *
 * A node has typed input and output ports. Wires run from an output port to an
 * input port of the same type, so a prompt can only feed a prompt slot, an image
 * only an image slot, and so on.
 */
export type PortType = "text" | "image" | "video" | "audio" | "brand";

export type NodeType =
  | "prompt"
  | "brand"
  | "image"
  | "generate_image"
  | "edit_image"
  | "upscale"
  | "remove_bg"
  | "generate_video"
  | "voice"
  | "design"
  | "clips";

/** What a generative node asks an engine to do. */
export type Capability = "image" | "edit" | "upscale" | "remove_bg" | "video_i2v" | "video_t2v";

export type Port = { id: string; label: string; type: PortType; multiple?: boolean };

export type NodeDef = {
  type: NodeType;
  label: string;
  group: "Inputs" | "Generate" | "Enhance" | "Finish";
  description: string;
  inputs: Port[];
  outputs: Port[];
  /** True when the node calls an engine (or another studio) and so has a Run button. */
  runnable: boolean;
  defaults: Record<string, unknown>;
};

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  prompt: {
    type: "prompt",
    label: "Prompt",
    group: "Inputs",
    description: "Describe what you want. Wire it into any generator.",
    inputs: [],
    outputs: [{ id: "text", label: "Text", type: "text" }],
    runnable: false,
    defaults: { text: "" },
  },
  brand: {
    type: "brand",
    label: "Brand kit",
    group: "Inputs",
    description: "Applies A Cup of Compassion's look, colors and brand assets to whatever it feeds.",
    inputs: [],
    outputs: [{ id: "brand", label: "Brand", type: "brand" }],
    runnable: false,
    defaults: { style: true, assetFileIds: [] },
  },
  image: {
    type: "image",
    label: "Image",
    group: "Inputs",
    description: "A photo from the Library or your device: a headshot, product, logo or reference.",
    inputs: [],
    outputs: [{ id: "image", label: "Image", type: "image" }],
    runnable: false,
    defaults: { fileId: "" },
  },
  generate_image: {
    type: "generate_image",
    label: "Generate image",
    group: "Generate",
    description: "Text to image with open models (FLUX, SDXL). Add a reference image to steer it.",
    inputs: [
      { id: "prompt", label: "Prompt", type: "text", multiple: true },
      { id: "brand", label: "Brand", type: "brand" },
      { id: "reference", label: "Reference", type: "image" },
    ],
    outputs: [{ id: "image", label: "Image", type: "image" }],
    runnable: true,
    defaults: { prompt: "", aspect: "1:1", count: 2, engine: "auto", model: "", enhance: true },
  },
  edit_image: {
    type: "edit_image",
    label: "Edit image",
    group: "Enhance",
    description: "Change an image with words: new background, outfit, lighting, add the logo (FLUX Kontext).",
    inputs: [
      { id: "image", label: "Image", type: "image" },
      { id: "prompt", label: "Prompt", type: "text", multiple: true },
      { id: "brand", label: "Brand", type: "brand" },
    ],
    outputs: [{ id: "image", label: "Image", type: "image" }],
    runnable: true,
    defaults: { prompt: "", engine: "auto", model: "", enhance: false },
  },
  upscale: {
    type: "upscale",
    label: "Upscale",
    group: "Enhance",
    description: "Sharpen and enlarge 2× or 4× (Real-ESRGAN), like Magnific.",
    inputs: [{ id: "image", label: "Image", type: "image" }],
    outputs: [{ id: "image", label: "Image", type: "image" }],
    runnable: true,
    defaults: { scale: 2, engine: "auto", model: "" },
  },
  remove_bg: {
    type: "remove_bg",
    label: "Remove background",
    group: "Enhance",
    description: "Cut out the subject (BiRefNet / rembg) for flyers and product shots.",
    inputs: [{ id: "image", label: "Image", type: "image" }],
    outputs: [{ id: "image", label: "Image", type: "image" }],
    runnable: true,
    defaults: { engine: "auto", model: "" },
  },
  generate_video: {
    type: "generate_video",
    label: "Generate video",
    group: "Generate",
    description: "Animate an image or make a clip from text (Wan, LTX-Video), like Runway.",
    inputs: [
      { id: "image", label: "Start frame", type: "image" },
      { id: "prompt", label: "Prompt", type: "text", multiple: true },
      { id: "brand", label: "Brand", type: "brand" },
    ],
    outputs: [{ id: "video", label: "Video", type: "video" }],
    runnable: true,
    defaults: { prompt: "", aspect: "9:16", engine: "auto", model: "", enhance: true },
  },
  voice: {
    type: "voice",
    label: "Her voice",
    group: "Generate",
    description: "Speaks the script in Pamela's cloned voice (ElevenLabs or open-source Chatterbox).",
    inputs: [{ id: "script", label: "Script", type: "text", multiple: true }],
    outputs: [{ id: "audio", label: "Audio", type: "audio" }],
    runnable: true,
    defaults: { script: "", cloneId: "" },
  },
  design: {
    type: "design",
    label: "Brand layout",
    group: "Finish",
    description: "Drops the image into a brand-locked template (purple, serif, full name and phone), like Canva.",
    inputs: [
      { id: "image", label: "Photo", type: "image" },
      { id: "headline", label: "Headline", type: "text" },
    ],
    outputs: [],
    runnable: true,
    defaults: { templateKey: "flyer", headline: "", body: "", cta: "" },
  },
  clips: {
    type: "clips",
    label: "Make clips",
    group: "Finish",
    description: "Sends a video to the clip studio: transcript, best moments, 9:16 captions, like Opus Clip.",
    inputs: [{ id: "video", label: "Video", type: "video" }],
    outputs: [],
    runnable: true,
    defaults: {},
  },
};

export type FlowNode = { id: string; type: NodeType; x: number; y: number; data: Record<string, unknown> };
export type FlowEdge = { id: string; from: string; fromPort: string; to: string; toPort: string };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };

export const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] };

export const ASPECTS = ["1:1", "4:5", "9:16", "16:9", "3:4", "4:3"] as const;
export type Aspect = (typeof ASPECTS)[number];

/** Pixel size for engines that want width/height (ComfyUI), ~1 megapixel, multiples of 64. */
export function aspectSize(aspect: string): { width: number; height: number } {
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h) return { width: 1024, height: 1024 };
  const scale = Math.sqrt((1024 * 1024) / (w * h));
  const snap = (n: number) => Math.max(256, Math.round((n * scale) / 64) * 64);
  return { width: snap(w), height: snap(h) };
}

/** Parses untrusted JSON (from the db or a client) into a well-formed graph, dropping anything invalid. */
export function normalizeGraph(raw: unknown): FlowGraph {
  const g = (raw ?? {}) as { nodes?: unknown; edges?: unknown };
  const nodes: FlowNode[] = [];
  for (const n of Array.isArray(g.nodes) ? g.nodes : []) {
    const o = n as Partial<FlowNode>;
    if (typeof o?.id !== "string" || !o.type || !(o.type in NODE_DEFS)) continue;
    nodes.push({
      id: o.id.slice(0, 64),
      type: o.type,
      x: Number.isFinite(o.x) ? Number(o.x) : 0,
      y: Number.isFinite(o.y) ? Number(o.y) : 0,
      data: { ...NODE_DEFS[o.type].defaults, ...(o.data && typeof o.data === "object" ? o.data : {}) },
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: FlowEdge[] = [];
  for (const e of Array.isArray(g.edges) ? g.edges : []) {
    const o = e as Partial<FlowEdge>;
    if (typeof o?.id !== "string" || typeof o.from !== "string" || typeof o.to !== "string") continue;
    const from = byId.get(o.from);
    const to = byId.get(o.to);
    if (!from || !to || !canConnect(from, String(o.fromPort), to, String(o.toPort))) continue;
    edges.push({ id: o.id, from: o.from, fromPort: String(o.fromPort), to: o.to, toPort: String(o.toPort) });
  }
  return { nodes, edges };
}

export function outPort(node: FlowNode, portId: string) {
  return NODE_DEFS[node.type].outputs.find((p) => p.id === portId);
}

export function inPort(node: FlowNode, portId: string) {
  return NODE_DEFS[node.type].inputs.find((p) => p.id === portId);
}

/** A wire is valid when both ports exist, carry the same type and don't loop a node onto itself. */
export function canConnect(from: FlowNode, fromPort: string, to: FlowNode, toPort: string) {
  if (from.id === to.id) return false;
  const a = outPort(from, fromPort);
  const b = inPort(to, toPort);
  return !!a && !!b && a.type === b.type;
}

/** Adds a wire, replacing the old one on a single-input port. Refuses wires that would make a cycle. */
export function connect(graph: FlowGraph, edge: Omit<FlowEdge, "id">, id: string): FlowGraph {
  const from = graph.nodes.find((n) => n.id === edge.from);
  const to = graph.nodes.find((n) => n.id === edge.to);
  if (!from || !to || !canConnect(from, edge.fromPort, to, edge.toPort)) return graph;
  if (upstreamIds(graph, edge.from).has(edge.to)) return graph;
  const port = inPort(to, edge.toPort)!;
  const edges = graph.edges.filter(
    (e) => !(e.to === edge.to && e.toPort === edge.toPort && (!port.multiple || e.from === edge.from)),
  );
  return { ...graph, edges: [...edges, { ...edge, id }] };
}

/** Every node the given node depends on, directly or indirectly. */
export function upstreamIds(graph: FlowGraph, nodeId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of graph.edges) {
      if (e.to === id && !seen.has(e.from)) {
        seen.add(e.from);
        stack.push(e.from);
      }
    }
  }
  return seen;
}

/** Nodes in dependency order (inputs before the nodes they feed). Nodes on a cycle are left out. */
export function topoOrder(graph: FlowGraph): FlowNode[] {
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = graph.nodes.filter((n) => indeg.get(n.id) === 0);
  const out: FlowNode[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const e of graph.edges) {
      if (e.from !== n.id) continue;
      const d = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, d);
      if (d === 0) queue.push(graph.nodes.find((x) => x.id === e.to)!);
    }
  }
  return out;
}

/** The nodes wired into one input port, in wire order. */
export function sourcesOf(graph: FlowGraph, nodeId: string, portId: string) {
  return graph.edges
    .filter((e) => e.to === nodeId && e.toPort === portId)
    .map((e) => ({ edge: e, node: graph.nodes.find((n) => n.id === e.from)! }))
    .filter((s) => s.node);
}

/** Which engine capability a generative node needs, given whether it has an image to start from. */
export function capabilityFor(type: NodeType, hasImage: boolean): Capability | null {
  switch (type) {
    case "generate_image":
      return hasImage ? "edit" : "image";
    case "edit_image":
      return "edit";
    case "upscale":
      return "upscale";
    case "remove_bg":
      return "remove_bg";
    case "generate_video":
      return hasImage ? "video_i2v" : "video_t2v";
    default:
      return null;
  }
}

export type BrandStyle = { name: string; tagline: string; visualStyle: string };

/**
 * The prompt an engine actually receives: her words, plus the brand's visual
 * direction when a Brand kit is wired in. Brand text is kept out of the image
 * itself (models garble lettering); the Brand layout node adds real type later.
 */
export function composePrompt(parts: string[], brand: BrandStyle | null, kind: "image" | "video" = "image") {
  const base = parts.map((p) => p.trim()).filter(Boolean).join(". ").replace(/\.\s*\./g, ".");
  if (!brand) return base;
  const motion = kind === "video" ? " Gentle, steady camera movement." : "";
  return [base, `Visual style for ${brand.name}: ${brand.visualStyle.trim()}${motion}`, "No words, letters or logos rendered in the image."]
    .filter(Boolean)
    .join("\n\n");
}

let counter = 0;
/** Short unique id for nodes and wires (time + counter + random). */
export function newId(prefix = "n") {
  counter = (counter + 1) % 1000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ───────────── Starter canvases ───────────── */

type Starter = { key: string; title: string; description: string; build: () => FlowGraph };

function n(type: NodeType, x: number, y: number, data: Record<string, unknown> = {}): FlowNode {
  return { id: newId(), type, x, y, data: { ...NODE_DEFS[type].defaults, ...data } };
}
function w(from: FlowNode, fromPort: string, to: FlowNode, toPort: string): FlowEdge {
  return { id: newId("e"), from: from.id, fromPort, to: to.id, toPort };
}

export const STARTERS: Starter[] = [
  {
    key: "blank",
    title: "Blank canvas",
    description: "Start from nothing and add nodes.",
    build: () => ({ nodes: [], edges: [] }),
  },
  {
    key: "social",
    title: "On-brand social post",
    description: "Prompt + brand kit → image → upscale → brand layout ready to post.",
    build: () => {
      const brand = n("brand", 40, 40);
      const prompt = n("prompt", 40, 340, { text: "A warm moment between a mother and her teenage son at a kitchen table, morning light" });
      const gen = n("generate_image", 400, 100, { aspect: "4:5" });
      const up = n("upscale", 760, 100);
      const layout = n("design", 1120, 100, { templateKey: "flyer", headline: "You don't have to walk this alone" });
      return { nodes: [brand, prompt, gen, up, layout], edges: [w(prompt, "text", gen, "prompt"), w(brand, "brand", gen, "brand"), w(gen, "image", up, "image"), w(up, "image", layout, "image")] };
    },
  },
  {
    key: "animate",
    title: "Animate a photo",
    description: "Bring a still photo to life as a short vertical video, then cut clips.",
    build: () => {
      const img = n("image", 40, 40);
      const prompt = n("prompt", 40, 460, { text: "She smiles and looks toward the camera, soft breeze, slow push-in" });
      const vid = n("generate_video", 400, 120, { aspect: "9:16" });
      const clips = n("clips", 760, 120);
      return { nodes: [img, prompt, vid, clips], edges: [w(img, "image", vid, "image"), w(prompt, "text", vid, "prompt"), w(vid, "video", clips, "video")] };
    },
  },
  {
    key: "product",
    title: "Product shot",
    description: "Cut out a product or book cover, restage it on brand, and sharpen it.",
    build: () => {
      const img = n("image", 40, 40);
      const cut = n("remove_bg", 400, 40);
      const brand = n("brand", 400, 560);
      const edit = n("edit_image", 760, 160, { prompt: "Place it on a soft lavender linen surface with morning light and a coffee cup beside it" });
      const up = n("upscale", 1120, 160);
      return { nodes: [img, cut, brand, edit, up], edges: [w(img, "image", cut, "image"), w(cut, "image", edit, "image"), w(brand, "brand", edit, "brand"), w(edit, "image", up, "image")] };
    },
  },
  {
    key: "voiceover",
    title: "Voiceover in her voice",
    description: "A script spoken in Pamela's cloned voice.",
    build: () => {
      const script = n("prompt", 40, 40, { text: "Hi, it's Pamela from A Cup of Compassion. I just wanted you to know I'm thinking about you this week." });
      const voice = n("voice", 400, 40);
      return { nodes: [script, voice], edges: [w(script, "text", voice, "script")] };
    },
  },
];
