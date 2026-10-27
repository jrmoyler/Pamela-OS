"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  Clapperboard,
  CircleAlert,
  Download,
  Expand,
  Film,
  History,
  ImageIcon,
  LayoutTemplate,
  Loader2,
  Maximize2,
  Minus,
  Palette,
  Play,
  Plus,
  Scan,
  Scissors,
  Settings2,
  Sparkles,
  Type,
  Upload,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ASPECTS,
  NODE_DEFS,
  capabilityFor,
  connect,
  newId,
  type Capability,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type NodeType,
  type PortType,
} from "@/lib/studio/graph";
import { runNodes, saveFlow } from "@/app/(app)/studio/actions";

/* ───────────── types & constants ───────────── */

export type CanvasFile = { id: string; name: string; mime: string };
export type CanvasGeneration = {
  id: string;
  nodeId: string;
  kind: string;
  status: string;
  provider: string | null;
  model: string | null;
  prompt: string | null;
  error: string | null;
  outputFileIds: string[];
  params: Record<string, unknown>;
  createdAt: string;
};

type Props = {
  flow: { id: string; title: string; graph: FlowGraph };
  generations: CanvasGeneration[];
  files: CanvasFile[];
  library: CanvasFile[];
  brandAssets: CanvasFile[];
  voices: { id: string; name: string }[];
  templates: { key: string; name: string; photo: boolean }[];
  capabilities: Record<Capability, string[]>;
};

const NODE_W = 300;
const HEADER_H = 44;
const PORT_TOP = 14;
const PORT_GAP = 26;

const ICONS: Record<NodeType, LucideIcon> = {
  prompt: Type,
  brand: Palette,
  image: ImageIcon,
  generate_image: Sparkles,
  edit_image: Wand2,
  upscale: Maximize2,
  remove_bg: Scissors,
  generate_video: Film,
  voice: AudioLines,
  design: LayoutTemplate,
  clips: Clapperboard,
};

const PORT_COLORS: Record<PortType, string> = {
  text: "#f5c04a",
  image: "#c084fc",
  video: "#38bdf8",
  audio: "#34d399",
  brand: "#f472b6",
};

const ENGINE_NAMES: Record<string, string> = { comfyui: "ComfyUI", replicate: "Replicate", fal: "fal", elevenlabs: "ElevenLabs", chatterbox: "Chatterbox", pamela: "Pamela OS" };

const portY = (i: number) => HEADER_H + PORT_TOP + i * PORT_GAP;
const fileUrl = (id: string) => `/api/files/${id}`;
const busy = (s?: string) => s === "queued" || s === "running";

/* ───────────── component ───────────── */

export function FlowCanvas(props: Props) {
  const [graph, setGraph] = useState<FlowGraph>(props.flow.graph);
  const [title, setTitle] = useState(props.flow.title);
  const [view, setView] = useState({ x: 80, y: 80, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [gens, setGens] = useState<CanvasGeneration[]>(props.generations);
  const [files, setFiles] = useState<Map<string, CanvasFile>>(() => new Map([...props.files, ...props.library, ...props.brandAssets].map((f) => [f.id, f])));
  const [library, setLibrary] = useState(props.library);
  const [brandAssets, setBrandAssets] = useState(props.brandAssets);
  const [wire, setWire] = useState<{ from: string; fromPort: string; type: PortType; x: number; y: number } | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<CanvasFile | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "pan" | "node"; id?: string; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const firstRender = useRef(true);
  const [top, setTop] = useState(57);
  const ticking = useRef(false);

  /* ── derived ── */
  const latest = useMemo(() => {
    const any = new Map<string, CanvasGeneration>();
    const done = new Map<string, CanvasGeneration>();
    for (const g of gens) {
      if (!any.has(g.nodeId)) any.set(g.nodeId, g);
      if (g.status === "done" && !done.has(g.nodeId)) done.set(g.nodeId, g);
    }
    return { any, done };
  }, [gens]);
  const working = gens.some((g) => busy(g.status));

  // The canvas fills the window below the app header, whose height differs on phones.
  useEffect(() => {
    const measure = () => setTop(Math.round(document.querySelector("header")?.getBoundingClientRect().bottom ?? 57));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  /* ── persistence ── */
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(() => {
      saveFlow(props.flow.id, title, graph)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 700);
    return () => clearTimeout(t);
  }, [graph, title, props.flow.id]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/studio/flows/${props.flow.id}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { generations: CanvasGeneration[]; files: CanvasFile[] };
    setGens(data.generations);
    setFiles((prev) => {
      const next = new Map(prev);
      for (const f of data.files) next.set(f.id, f);
      return next;
    });
  }, [props.flow.id]);

  // While anything is queued or running: nudge the scheduler (runs jobs inline when there's no worker) and poll.
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => {
      if (!ticking.current) {
        ticking.current = true;
        fetch("/api/cron/tick", { method: "POST" })
          .catch(() => {})
          .finally(() => (ticking.current = false));
      }
      refresh().catch(() => {});
    }, 2500);
    return () => clearInterval(id);
  }, [working, refresh]);

  const run = async (nodeIds: string[] | null) => {
    setNotice(null);
    try {
      const r = await runNodes(props.flow.id, title, graph, nodeIds);
      if (!r.queued) setNotice(nodeIds ? "That node is already running." : "Nothing to run yet. Add a generator node.");
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  /* ── graph edits ── */
  const updateNode = (id: string, data: Record<string, unknown>) =>
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)) }));
  const removeNode = (id: string) => {
    setGraph((g) => ({ nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) }));
    setSelected((s) => (s === id ? null : s));
  };
  const removeEdge = (id: string) => setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== id) }));

  const addNode = (type: NodeType, data: Record<string, unknown> = {}) => {
    const el = rootRef.current;
    const w = el?.clientWidth ?? 1000;
    const h = el?.clientHeight ?? 700;
    const offset = (graph.nodes.length % 6) * 24;
    const node: FlowNode = {
      id: newId(),
      type,
      x: Math.round(((w + (w >= 640 ? 200 : 76)) / 2 - view.x) / view.k - NODE_W / 2 + offset),
      y: Math.round((h / 2 - view.y) / view.k - 120 + offset),
      data: { ...NODE_DEFS[type].defaults, ...data },
    };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, node] }));
    setSelected(node.id);
    return node;
  };

  /* ── view: fit, zoom, pan ── */
  // Frame the whole canvas on first paint; later fits come from the toolbar button.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => fitView(rootRef.current, graph, setView), []);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const el = rootRef.current;
      const px = cx ?? (el?.clientWidth ?? 0) / 2;
      const py = cy ?? (el?.clientHeight ?? 0) / 2;
      const k = Math.min(2, Math.max(0.25, v.k * factor));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("textarea, select, [data-scroll]")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) removeNode(selected);
      if (e.key === "Escape") {
        setSelected(null);
        setPreview(null);
        setWire(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toWorld = (clientX: number, clientY: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    setSelected(null);
    drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onNodeDown = (e: React.PointerEvent, n: FlowNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(n.id);
    drag.current = { kind: "node", id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y };
    rootRef.current?.setPointerCapture(e.pointerId);
  };

  const onPortDown = (e: React.PointerEvent, n: FlowNode, portId: string, type: PortType) => {
    e.stopPropagation();
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    setWire({ from: n.id, fromPort: portId, type, x: p.x, y: p.y });
    rootRef.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (wire) {
      const p = toWorld(e.clientX, e.clientY);
      setWire((w) => (w ? { ...w, x: p.x, y: p.y } : w));
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") setView((v) => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy }));
    else {
      const x = Math.round(d.ox + (e.clientX - d.sx) / view.k);
      const y = Math.round(d.oy + (e.clientY - d.sy) / view.k);
      setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === d.id ? { ...n, x, y } : n)) }));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    if (wire) {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-in-port]");
      if (target) {
        const to = target.dataset.node!;
        const toPort = target.dataset.inPort!;
        setGraph((g) => connect(g, { from: wire.from, fromPort: wire.fromPort, to, toPort }, newId("e")));
      }
      setWire(null);
    }
    drag.current = null;
  };

  /* ── uploads (to the Library, then onto the canvas) ── */
  const upload = async (file: File, tags: string[]): Promise<CanvasFile | null> => {
    const form = new FormData();
    form.append("file", file);
    form.append("tags", tags.join(","));
    form.append("description", "Added from the Create studio");
    const res = await fetch("/api/library/upload", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ids?.[0]) {
      setNotice(data.error ?? "Upload failed.");
      return null;
    }
    const f = { id: data.ids[0] as string, name: file.name, mime: file.type || "image/png" };
    setFiles((prev) => new Map(prev).set(f.id, f));
    return f;
  };

  /* ── node chrome ── */
  const capOf = (n: FlowNode): Capability | null => {
    const imgPort = n.type === "generate_image" ? "reference" : "image";
    const hasImage = graph.edges.some((e) => e.to === n.id && e.toPort === imgPort);
    const brandEdge = graph.edges.find((e) => e.to === n.id && e.toPort === "brand");
    const brandNode = brandEdge && graph.nodes.find((x) => x.id === brandEdge.from);
    const brandRef = n.type === "generate_image" && ((brandNode?.data.assetFileIds as string[] | undefined)?.length ?? 0) > 0;
    return capabilityFor(n.type, hasImage || brandRef);
  };

  const edgePath = (e: FlowEdge) => {
    const a = graph.nodes.find((n) => n.id === e.from);
    const b = graph.nodes.find((n) => n.id === e.to);
    if (!a || !b) return null;
    const ai = NODE_DEFS[a.type].outputs.findIndex((p) => p.id === e.fromPort);
    const bi = NODE_DEFS[b.type].inputs.findIndex((p) => p.id === e.toPort);
    return bezier(a.x + NODE_W, a.y + portY(ai), b.x, b.y + portY(bi));
  };

  const wireStart = wire && graph.nodes.find((n) => n.id === wire.from);

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 select-none bg-[#0d0a12] text-zinc-100 lg:left-60" style={{ top }}>
      {/* top bar */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-white/5 bg-[#0d0a12]/90 px-3 py-2 backdrop-blur">
        <Link href="/studio" className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="Back to Create">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Canvas name" className="min-w-0 max-w-xs flex-1 rounded-lg bg-transparent px-2 py-1 text-sm font-semibold text-white outline-none hover:bg-white/5 focus:bg-white/5" />
        <span className="hidden text-xs text-zinc-500 sm:inline">{saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save" : "Saved"}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => zoomAt(1 / 1.2)} className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
          <span className="w-10 text-center text-xs tabular-nums text-zinc-500">{Math.round(view.k * 100)}%</span>
          <button onClick={() => zoomAt(1.2)} className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
          <button onClick={() => fitView(rootRef.current, graph, setView)} className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="Fit to screen"><Scan className="h-4 w-4" /></button>
          <button onClick={() => setHistoryOpen((o) => !o)} className={cn("ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium hover:bg-white/5", historyOpen ? "text-white" : "text-zinc-400")}>
            <History className="h-4 w-4" /> <span className="hidden sm:inline">History</span>
          </button>
          <Link href="/studio/engines" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-400 hover:bg-white/5 hover:text-white">
            <Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Engines</span>
          </Link>
          <button onClick={() => run(null)} className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-white shadow-[0_0_24px_rgba(106,27,154,0.6)] hover:bg-[#7d2bb3]">
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run all
          </button>
        </div>
      </div>

      {/* node palette */}
      <NodePalette onAdd={(t) => addNode(t)} />

      {notice && (
        <div className="absolute left-1/2 top-14 z-30 flex max-w-lg -translate-x-1/2 items-start gap-2 rounded-xl border border-amber-400/30 bg-[#2a2010] px-3 py-2 text-xs text-amber-200 shadow-xl">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* canvas */}
      <div
        ref={rootRef}
        className="absolute inset-0 top-12 overflow-hidden"
        style={{
          touchAction: "none",
          backgroundColor: "#0d0a12",
          backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)",
          backgroundSize: `${22 * view.k}px ${22 * view.k}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {graph.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-brand" />
              <p className="text-sm font-medium text-zinc-300">Add a node from the left to start.</p>
              <p className="mt-1 text-xs text-zinc-500">Drag from a dot on the right of a node to a dot on the left of another to wire them.</p>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1">
            {graph.edges.map((e) => {
              const d = edgePath(e);
              if (!d) return null;
              const from = graph.nodes.find((n) => n.id === e.from)!;
              const type = NODE_DEFS[from.type].outputs.find((p) => p.id === e.fromPort)!.type;
              return (
                <g key={e.id} className="group pointer-events-auto cursor-pointer" onClick={() => removeEdge(e.id)}>
                  <title>Click to remove this wire</title>
                  <path d={d} stroke="transparent" strokeWidth={14} fill="none" />
                  <path d={d} stroke={PORT_COLORS[type]} strokeOpacity={0.75} strokeWidth={2.5} fill="none" className="group-hover:stroke-red-400" />
                </g>
              );
            })}
            {wire && wireStart && (
              <path
                d={bezier(wireStart.x + NODE_W, wireStart.y + portY(NODE_DEFS[wireStart.type].outputs.findIndex((p) => p.id === wire.fromPort)), wire.x, wire.y)}
                stroke={PORT_COLORS[wire.type]}
                strokeWidth={2.5}
                strokeDasharray="6 5"
                fill="none"
              />
            )}
          </svg>

          {graph.nodes.map((n) => {
            const def = NODE_DEFS[n.type];
            const Icon = ICONS[n.type];
            const last = latest.any.get(n.id);
            const done = latest.done.get(n.id);
            const portRows = Math.max(def.inputs.length, def.outputs.length);
            const cap = def.runnable ? capOf(n) : null;
            const noEngine = cap && !props.capabilities[cap]?.length;
            return (
              <div
                key={n.id}
                className={cn(
                  "pointer-events-auto absolute rounded-2xl border bg-[#17121f] shadow-[0_12px_40px_rgba(0,0,0,0.45)]",
                  selected === n.id ? "border-brand ring-2 ring-brand/40" : "border-white/10",
                )}
                style={{ left: n.x, top: n.y, width: NODE_W }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelected(n.id);
                }}
              >
                {/* header (drag handle) */}
                <div className="flex cursor-grab items-center gap-2 rounded-t-2xl border-b border-white/5 px-3 active:cursor-grabbing" style={{ height: HEADER_H }} onPointerDown={(e) => onNodeDown(e, n)}>
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-brand/25 text-[#d8b4fe]"><Icon className="h-3.5 w-3.5" /></span>
                  <span className="flex-1 truncate text-[13px] font-semibold">{def.label}</span>
                  {last && <StatusDot status={last.status} />}
                  {def.runnable && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => run([n.id])}
                      disabled={busy(last?.status)}
                      className="inline-flex h-7 items-center gap-1 rounded-lg bg-white/10 px-2 text-[11px] font-semibold hover:bg-brand disabled:opacity-60"
                      title="Run this node"
                    >
                      {busy(last?.status) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      {busy(last?.status) ? (last?.status === "queued" ? "Queued" : "Running") : "Run"}
                    </button>
                  )}
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={() => removeNode(n.id)} className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white" aria-label={`Remove ${def.label}`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* ports */}
                {def.inputs.map((p, i) => (
                  <div key={p.id} className="absolute left-0 flex items-center gap-1.5" style={{ top: portY(i) - 8 }}>
                    <span
                      data-in-port={p.id}
                      data-node={n.id}
                      className={cn("-ml-[8px] h-4 w-4 rounded-full border-2 border-[#17121f] transition", wire && wire.type === p.type && wire.from !== n.id && "scale-150 ring-2 ring-white/60")}
                      style={{ background: PORT_COLORS[p.type] }}
                      title={`${p.label} (${p.type})`}
                    />
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{p.label}</span>
                  </div>
                ))}
                {def.outputs.map((p, i) => (
                  <div key={p.id} className="absolute right-0 flex items-center gap-1.5" style={{ top: portY(i) - 8 }}>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{p.label}</span>
                    <span
                      onPointerDown={(e) => onPortDown(e, n, p.id, p.type)}
                      className="-mr-[8px] h-4 w-4 cursor-crosshair rounded-full border-2 border-[#17121f] hover:scale-125"
                      style={{ background: PORT_COLORS[p.type] }}
                      title={`Drag to connect ${p.label}`}
                    />
                  </div>
                ))}

                {/* body */}
                <div className="space-y-2.5 px-3 pb-3" style={{ paddingTop: portRows ? portRows * PORT_GAP + 8 : 12 }} onPointerDown={(e) => e.stopPropagation()}>
                  <NodeBody
                    node={n}
                    update={(d) => updateNode(n.id, d)}
                    voices={props.voices}
                    templates={props.templates}
                    library={library}
                    brandAssets={brandAssets}
                    files={files}
                    onUpload={async (file, brand) => {
                      const f = await upload(file, brand ? ["brand"] : ["studio-input"]);
                      if (!f) return null;
                      if (brand) setBrandAssets((a) => [f, ...a]);
                      else setLibrary((l) => [f, ...l]);
                      return f;
                    }}
                  />
                  {noEngine && (
                    <Link href="/studio/engines" className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300 hover:bg-amber-500/20">
                      <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> No engine connected for this yet. Set one up →
                    </Link>
                  )}
                  {last?.status === "failed" && <p className="rounded-lg bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">{last.error}</p>}
                  {def.runnable && (
                    <NodeOutput
                      node={n}
                      gen={done}
                      running={busy(last?.status)}
                      files={files}
                      onPick={(i) => updateNode(n.id, { pick: i })}
                      onOpen={(f) => setPreview(f)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* history drawer */}
      {historyOpen && (
        <div className="absolute inset-x-0 bottom-0 z-30 max-h-56 border-t border-white/10 bg-[#120e18]/95 p-3 backdrop-blur" data-scroll>
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
            <span className="font-semibold text-zinc-200">Everything made on this canvas</span>
            <span>Also saved to the Library</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {gens.flatMap((g) => g.outputFileIds.map((id) => ({ id, g }))).length === 0 && <p className="text-xs text-zinc-500">Nothing yet. Run a node.</p>}
            {gens.flatMap((g) =>
              g.outputFileIds.map((id) => {
                const f = files.get(id);
                return (
                  <button key={id} onClick={() => f && setPreview(f)} className="h-32 w-32 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40 hover:border-brand" title={g.prompt ?? ""}>
                    <Thumb file={f} />
                  </button>
                );
              }),
            )}
          </div>
        </div>
      )}

      {/* lightbox */}
      {preview && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/80 p-6 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="flex max-h-full max-w-4xl flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="min-h-0 overflow-hidden rounded-xl bg-[repeating-conic-gradient(#222_0_25%,#2c2c2c_0_50%)] [background-size:20px_20px]">
              {preview.mime.startsWith("video/") ? (
                <video src={fileUrl(preview.id)} controls autoPlay loop className="max-h-[70vh] w-full" />
              ) : preview.mime.startsWith("audio/") ? (
                <audio src={fileUrl(preview.id)} controls autoPlay className="m-6" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(preview.id)} alt={preview.name} className="max-h-[70vh] w-auto object-contain" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto truncate text-xs text-zinc-400">{preview.name}</span>
              {preview.mime.startsWith("image/") && (
                <button
                  onClick={() => {
                    addNode("image", { fileId: preview.id });
                    setPreview(null);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-medium hover:bg-white/20"
                >
                  <Plus className="h-3.5 w-3.5" /> Use on canvas
                </button>
              )}
              <a href={fileUrl(preview.id)} download={preview.name} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-medium hover:bg-white/20">
                <Download className="h-3.5 w-3.5" /> Download
              </a>
              <Link href={`/library/${preview.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold hover:bg-[#7d2bb3]">
                Open in Library
              </Link>
              <button onClick={() => setPreview(null)} className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 hover:bg-white/20" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── pieces ───────────── */

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function fitView(el: HTMLDivElement | null, graph: FlowGraph, setView: (v: { x: number; y: number; k: number }) => void) {
  // Keep clear of the node palette on the left (narrow on phones, labelled from sm up).
  const left = el && el.clientWidth >= 640 ? 200 : 76;
  if (!el || !graph.nodes.length) return setView({ x: left + 20, y: 60, k: 1 });
  const minX = Math.min(...graph.nodes.map((n) => n.x)) - 40;
  const minY = Math.min(...graph.nodes.map((n) => n.y)) - 40;
  const maxX = Math.max(...graph.nodes.map((n) => n.x)) + NODE_W + 40;
  const maxY = Math.max(...graph.nodes.map((n) => n.y)) + 460;
  const width = el.clientWidth - left;
  const k = Math.min(1, Math.max(0.3, Math.min(width / (maxX - minX), (el.clientHeight - 40) / (maxY - minY))));
  setView({ k, x: left + (width - (maxX - minX) * k) / 2 - minX * k, y: 30 - minY * k });
}

function StatusDot({ status }: { status: string }) {
  const tone = status === "done" ? "bg-emerald-400" : status === "failed" ? "bg-red-400" : "animate-pulse bg-amber-400";
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", tone)} title={status} />;
}

function NodePalette({ onAdd }: { onAdd: (t: NodeType) => void }) {
  const groups = ["Inputs", "Generate", "Enhance", "Finish"] as const;
  return (
    <div className="absolute left-3 top-[60px] z-20 flex max-h-[calc(100%-72px)] w-14 flex-col gap-3 overflow-y-auto rounded-2xl border border-white/10 bg-[#120e18]/90 py-3 backdrop-blur sm:w-44 sm:px-2" data-scroll>
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1 hidden px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:block">{g}</p>
          {Object.values(NODE_DEFS)
            .filter((d) => d.group === g)
            .map((d) => {
              const Icon = ICONS[d.type];
              return (
                <button
                  key={d.type}
                  onClick={() => onAdd(d.type)}
                  title={d.description}
                  className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-zinc-300 hover:bg-brand/30 hover:text-white sm:justify-start"
                >
                  <Icon className="h-4 w-4 shrink-0 text-[#d8b4fe]" />
                  <span className="hidden truncate sm:inline">{d.label}</span>
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}

const darkField = "w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-brand focus:outline-none";
const darkLabel = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={darkLabel}>{label}</span>
      {children}
    </label>
  );
}

function EngineSelect({ node, update }: { node: FlowNode; update: (d: Record<string, unknown>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Row label="Engine">
        <select className={darkField} value={String(node.data.engine ?? "auto")} onChange={(e) => update({ engine: e.target.value })}>
          <option value="auto">Auto</option>
          <option value="comfyui">ComfyUI</option>
          <option value="replicate">Replicate</option>
          <option value="fal">fal</option>
        </select>
      </Row>
      <Row label="Model (optional)">
        <input className={darkField} value={String(node.data.model ?? "")} onChange={(e) => update({ model: e.target.value })} placeholder="default" />
      </Row>
    </div>
  );
}

function UploadButton({ label, onFile }: { label: string; onFile: (f: File) => Promise<unknown> }) {
  const [busyUp, setBusyUp] = useState(false);
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-medium hover:bg-white/20">
      {busyUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {label}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusyUp(true);
          await onFile(f).finally(() => setBusyUp(false));
        }}
      />
    </label>
  );
}

function NodeBody({
  node,
  update,
  voices,
  templates,
  library,
  brandAssets,
  files,
  onUpload,
}: {
  node: FlowNode;
  update: (d: Record<string, unknown>) => void;
  voices: Props["voices"];
  templates: Props["templates"];
  library: CanvasFile[];
  brandAssets: CanvasFile[];
  files: Map<string, CanvasFile>;
  onUpload: (f: File, brand: boolean) => Promise<CanvasFile | null>;
}) {
  const d = node.data;
  const text = (key: string, placeholder: string, rows = 3) => (
    <textarea className={cn(darkField, "resize-y leading-relaxed")} rows={rows} value={String(d[key] ?? "")} onChange={(e) => update({ [key]: e.target.value })} placeholder={placeholder} />
  );
  const enhance = (
    <label className="flex items-center gap-2 text-[11px] text-zinc-400">
      <input type="checkbox" className="accent-brand" checked={!!d.enhance} onChange={(e) => update({ enhance: e.target.checked })} />
      Let RJ enrich the prompt
    </label>
  );

  switch (node.type) {
    case "prompt":
      return text("text", "A warm portrait of Pamela speaking to a small group of women in a sunlit church hall…", 5);
    case "brand": {
      const picked = new Set((d.assetFileIds as string[]) ?? []);
      return (
        <>
          <label className="flex items-center gap-2 text-[11px] text-zinc-300">
            <input type="checkbox" className="accent-brand" checked={d.style !== false} onChange={(e) => update({ style: e.target.checked })} />
            Apply the brand look (Settings → Brand kit)
          </label>
          <div>
            <span className={darkLabel}>Brand assets {picked.size ? `· ${picked.size} picked` : ""}</span>
            {brandAssets.length ? (
              <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto" data-scroll>
                {brandAssets.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => update({ assetFileIds: picked.has(f.id) ? [...picked].filter((x) => x !== f.id) : [...picked, f.id] })}
                    className={cn("aspect-square overflow-hidden rounded-md border-2", picked.has(f.id) ? "border-brand" : "border-transparent opacity-70 hover:opacity-100")}
                    title={f.name}
                  >
                    <Thumb file={f} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500">Tag logos, headshots and product photos “brand” in the Library, or upload one here.</p>
            )}
            <p className="mt-1 text-[10px] text-zinc-500">The first picked asset becomes the reference for image generators.</p>
          </div>
          <UploadButton label="Upload brand asset" onFile={async (f) => {
            const up = await onUpload(f, true);
            if (up) update({ assetFileIds: [...picked, up.id] });
          }} />
        </>
      );
    }
    case "image": {
      const f = d.fileId ? files.get(String(d.fileId)) : undefined;
      return (
        <>
          <div className="aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-black/40">
            {d.fileId ? <Thumb file={f ?? { id: String(d.fileId), name: "", mime: "image/png" }} contain /> : <div className="grid h-full place-items-center text-[11px] text-zinc-500">No image yet</div>}
          </div>
          <select className={darkField} value={String(d.fileId ?? "")} onChange={(e) => update({ fileId: e.target.value })}>
            <option value="">Pick from the Library…</option>
            {library.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <UploadButton label="Upload from device" onFile={async (file) => {
            const up = await onUpload(file, false);
            if (up) update({ fileId: up.id });
          }} />
        </>
      );
    }
    case "generate_image":
      return (
        <>
          {text("prompt", "Describe the image, or wire in a Prompt node")}
          <div className="grid grid-cols-2 gap-2">
            <Row label="Aspect">
              <select className={darkField} value={String(d.aspect)} onChange={(e) => update({ aspect: e.target.value })}>
                {ASPECTS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </Row>
            <Row label="Images">
              <select className={darkField} value={String(d.count)} onChange={(e) => update({ count: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Row>
          </div>
          <EngineSelect node={node} update={update} />
          {enhance}
        </>
      );
    case "edit_image":
      return (
        <>
          {text("prompt", "What to change: “swap the background for a sunset garden”, “add a purple scarf”…")}
          <EngineSelect node={node} update={update} />
        </>
      );
    case "upscale":
      return (
        <>
          <Row label="Scale">
            <select className={darkField} value={String(d.scale)} onChange={(e) => update({ scale: Number(e.target.value) })}>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </Row>
          <EngineSelect node={node} update={update} />
        </>
      );
    case "remove_bg":
      return <EngineSelect node={node} update={update} />;
    case "generate_video":
      return (
        <>
          {text("prompt", "Describe the motion: “slow push-in, she looks up and smiles”")}
          <Row label="Aspect (text → video)">
            <select className={darkField} value={String(d.aspect)} onChange={(e) => update({ aspect: e.target.value })}>
              {["9:16", "16:9", "1:1"].map((a) => <option key={a}>{a}</option>)}
            </select>
          </Row>
          <EngineSelect node={node} update={update} />
          {enhance}
        </>
      );
    case "voice":
      return (
        <>
          {text("script", "What she says (or wire in a Prompt)", 4)}
          <Row label="Voice">
            <select className={darkField} value={String(d.cloneId ?? "")} onChange={(e) => update({ cloneId: e.target.value })}>
              <option value="">{voices.length ? "First ready voice" : "No voice yet: create one in Her voice"}</option>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Row>
        </>
      );
    case "design":
      return (
        <>
          <Row label="Template">
            <select className={darkField} value={String(d.templateKey)} onChange={(e) => update({ templateKey: e.target.value })}>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name}{t.photo ? "" : " (no photo)"}</option>)}
            </select>
          </Row>
          <Row label="Headline">
            <input className={darkField} value={String(d.headline ?? "")} onChange={(e) => update({ headline: e.target.value })} placeholder="Or wire a Prompt into Headline" />
          </Row>
          <Row label="Body">
            <input className={darkField} value={String(d.body ?? "")} onChange={(e) => update({ body: e.target.value })} />
          </Row>
          <Row label="Call to action">
            <input className={darkField} value={String(d.cta ?? "")} onChange={(e) => update({ cta: e.target.value })} placeholder="Call (323) 943-ACUP" />
          </Row>
        </>
      );
    case "clips":
      return <p className="text-[11px] leading-relaxed text-zinc-400">Transcribes the video, scores the best moments and renders captioned 9:16 clips in Video clips. Posting still goes through Approvals.</p>;
  }
}

function NodeOutput({
  node,
  gen,
  running,
  files,
  onPick,
  onOpen,
}: {
  node: FlowNode;
  gen?: CanvasGeneration;
  running: boolean;
  files: Map<string, CanvasFile>;
  onPick: (i: number) => void;
  onOpen: (f: CanvasFile) => void;
}) {
  if (node.type === "design" || node.type === "clips") {
    const id = gen?.params[node.type === "design" ? "designId" : "videoId"];
    if (running) return <Working label={node.type === "design" ? "Laying it out…" : "Sending to the clip studio…"} />;
    if (!id) return null;
    return (
      <Link href={node.type === "design" ? `/studio/design/${id}` : `/studio/video/${id}`} className="flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-[#7d2bb3]">
        {node.type === "design" ? "Open in Design to export and post" : "Open clips"} <Expand className="h-3.5 w-3.5" />
      </Link>
    );
  }
  if (!gen && !running) return <div className="grid aspect-[4/3] place-items-center rounded-lg border border-dashed border-white/10 text-[11px] text-zinc-600">Output appears here</div>;
  const outputs = gen?.outputFileIds ?? [];
  const pick = Math.min(Number(node.data.pick ?? 0), Math.max(0, outputs.length - 1));
  return (
    <div className="space-y-1.5">
      <div className="relative">
        {outputs.length > 0 && (
          <div className={cn("grid gap-1.5", outputs.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
            {outputs.map((id, i) => {
              const f = files.get(id) ?? { id, name: "", mime: node.type === "voice" ? "audio/mpeg" : node.type === "generate_video" ? "video/mp4" : "image/png" };
              return (
                <div key={id} className={cn("group relative overflow-hidden rounded-lg border-2 bg-[repeating-conic-gradient(#1d1d1d_0_25%,#262626_0_50%)] [background-size:14px_14px]", outputs.length > 1 && pick === i ? "border-brand" : "border-transparent")}>
                  {f.mime.startsWith("audio/") ? (
                    <audio src={fileUrl(id)} controls className="w-full" />
                  ) : (
                    <button onClick={() => (outputs.length > 1 ? onPick(i) : onOpen(f))} className="block w-full" title={outputs.length > 1 ? "Use this one downstream" : "Open"}>
                      <Thumb file={f} contain />
                    </button>
                  )}
                  {!f.mime.startsWith("audio/") && (
                    <button onClick={() => onOpen(f)} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-black/60 opacity-0 transition group-hover:opacity-100" aria-label="Open large">
                      <Expand className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {running && (
          <div className={cn(outputs.length ? "absolute inset-0 rounded-lg bg-black/60" : "aspect-[4/3] rounded-lg border border-white/10 bg-black/30")}>
            <Working label="Generating…" />
          </div>
        )}
      </div>
      {gen && (
        <p className="truncate text-[10px] text-zinc-500" title={gen.model ?? ""}>
          {ENGINE_NAMES[gen.provider ?? ""] ?? gen.provider} · {gen.model}
        </p>
      )}
    </div>
  );
}

function Working({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-16 flex-col items-center justify-center gap-2 text-[11px] text-zinc-300">
      <Loader2 className="h-5 w-5 animate-spin text-[#d8b4fe]" />
      {label}
    </div>
  );
}

function Thumb({ file, contain }: { file?: CanvasFile; contain?: boolean }) {
  if (!file) return <div className="h-full w-full bg-white/5" />;
  if (file.mime.startsWith("video/")) return <video src={fileUrl(file.id)} muted loop autoPlay playsInline className="h-full w-full object-cover" />;
  if (file.mime.startsWith("audio/")) return <div className="grid h-full place-items-center text-emerald-300"><AudioLines className="h-6 w-6" /></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={fileUrl(file.id)} alt={file.name} draggable={false} className={cn("h-full w-full", contain ? "object-contain" : "object-cover")} />;
}
