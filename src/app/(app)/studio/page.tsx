import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { Sparkles, Settings2, Film, AudioLines, ImageIcon, LayoutTemplate, Clapperboard, Palette } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { Card, CardHeader, Badge, Button, EmptyState } from "@/components/ui";
import { fileUrl } from "@/lib/storage";
import { timeAgo } from "@/lib/utils";
import { STARTERS } from "@/lib/studio/graph";
import { CAPABILITY_LABELS, ENGINE_LABELS, engineStatus, type EngineId } from "@/lib/studio/engines";
import { voiceProviders } from "@/lib/modules/voice";
import { createFlow } from "./actions";

export const metadata = { title: "Create" };

const STARTER_ICONS: Record<string, typeof Sparkles> = { blank: Sparkles, social: LayoutTemplate, animate: Film, product: ImageIcon, voiceover: AudioLines };

export default async function CreateHome() {
  const db = await getDb();
  const [flows, recent, status, voices] = await Promise.all([
    db.select().from(schema.studioFlows).orderBy(desc(schema.studioFlows.updatedAt)).limit(60),
    db.select().from(schema.studioGenerations).where(eq(schema.studioGenerations.status, "done")).orderBy(desc(schema.studioGenerations.createdAt)).limit(40),
    engineStatus(),
    voiceProviders(),
  ]);
  const outputIds = recent.flatMap((g) => g.outputFileIds).slice(0, 24);
  const outputs = outputIds.length ? await db.select().from(schema.files).where(inArray(schema.files.id, outputIds)) : [];
  const byId = new Map(outputs.map((f) => [f.id, f]));
  const anyEngine = Object.values(status.engines).some(Boolean);

  return (
    <>
      <section className="relative mb-6 overflow-hidden rounded-2xl bg-[#0d0a12] px-6 py-8 text-white sm:px-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/50 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-xl">
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-[#e9d5ff]">
              <Sparkles className="h-3.5 w-3.5" /> Create studio
            </p>
            <h1 className="text-3xl font-bold tracking-tight">What are we making today?</h1>
            <p className="mt-2 text-sm text-zinc-300">
              Wire prompts, photos and the brand kit into image, video and voice generators on one canvas. Everything comes out on-brand and lands in the Library. Posting still waits for your approval.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/studio/engines" className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-medium text-white hover:bg-white/10">
              <Settings2 className="h-4 w-4" /> Engines
            </Link>
            <form action={createFlow}>
              <input type="hidden" name="starter" value="blank" />
              <button className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-[0_0_30px_rgba(106,27,154,0.7)] hover:bg-[#7d2bb3]">
                <Sparkles className="h-4 w-4" /> New canvas
              </button>
            </form>
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STARTERS.filter((s) => s.key !== "blank").map((s) => {
            const Icon = STARTER_ICONS[s.key] ?? Sparkles;
            return (
              <form key={s.key} action={createFlow}>
                <input type="hidden" name="starter" value={s.key} />
                <button className="group flex h-full w-full flex-col items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-brand hover:bg-brand/20">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/40 text-[#e9d5ff] group-hover:bg-brand"><Icon className="h-4 w-4" /></span>
                  <span className="text-sm font-semibold">{s.title}</span>
                  <span className="text-xs text-zinc-400">{s.description}</span>
                </button>
              </form>
            );
          })}
        </div>
      </section>

      {!anyEngine && (
        <Card className="mb-6 flex flex-wrap items-center gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex-1">
            <strong>Connect an engine to start generating.</strong> Point Pamela OS at her own ComfyUI box, or add a Replicate or fal key for hosted open models. Canvases can be built now and run once an engine is connected.
          </p>
          <Link href="/settings#connections"><Button size="sm" variant="outline">Settings → Connections</Button></Link>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 font-semibold text-brand-ink">Canvases</h2>
          {flows.length === 0 ? (
            <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No canvases yet">
              Pick a starter above. Each one opens as a node canvas you can change and run.
            </EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {flows.map((f) => (
                <Link key={f.id} href={`/studio/create/${f.id}`}>
                  <Card className="h-full overflow-hidden transition hover:border-brand/40">
                    <div className="relative aspect-video bg-[#0d0a12] bg-[radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:14px_14px]">
                      {f.coverFileId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fileUrl(f.coverFileId)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center text-xs text-zinc-500">{(f.graph.nodes ?? []).length} nodes</div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="truncate text-sm font-medium">{f.title}</p>
                      <p className="text-xs text-zinc-500">Edited {timeAgo(f.updatedAt)}</p>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          <h2 className="mb-3 mt-8 font-semibold text-brand-ink">Recently made</h2>
          {outputIds.length === 0 ? (
            <p className="text-sm text-zinc-500">Generated images, videos and voice clips show up here and in the Library.</p>
          ) : (
            <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">
              {outputIds.map((id) => {
                const f = byId.get(id);
                if (!f) return null;
                return (
                  <Link key={id} href={`/library/${id}`} className="mb-3 block break-inside-avoid overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 hover:border-brand/40">
                    {f.kind === "video" ? (
                      <video src={fileUrl(id)} muted loop autoPlay playsInline className="w-full" />
                    ) : f.kind === "audio" ? (
                      <div className="flex items-center gap-2 p-4 text-xs text-zinc-600"><AudioLines className="h-4 w-4 text-brand" /> {f.name}</div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(id)} alt={f.description ?? f.name} className="w-full" />
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Engines" subtitle="Open-source models behind each node" action={<Link href="/studio/engines" className="text-xs font-medium text-brand">Set up</Link>} />
            <ul className="divide-y divide-zinc-100 text-sm">
              {(Object.keys(ENGINE_LABELS) as EngineId[]).map((e) => (
                <li key={e} className="flex items-center justify-between px-4 py-2.5">
                  <span>{ENGINE_LABELS[e]}</span>
                  <Badge tone={status.engines[e] ? "green" : "default"}>{status.engines[e] ? "connected" : "not set"}</Badge>
                </li>
              ))}
              <li className="flex items-center justify-between px-4 py-2.5">
                <span>Her voice (ElevenLabs / Chatterbox)</span>
                <Badge tone={voices.length ? "green" : "default"}>{voices.length ? voices.join(", ") : "not set"}</Badge>
              </li>
            </ul>
            <div className="border-t border-zinc-100 px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Ready to run</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(CAPABILITY_LABELS).map(([cap, label]) => (
                  <Badge key={cap} tone={status.capabilities[cap as keyof typeof CAPABILITY_LABELS].length ? "brand" : "default"}>{label}</Badge>
                ))}
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Finish in the other studios" />
            <div className="grid gap-2 p-4 text-sm">
              <Link href="/studio/design" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-brand-soft"><Palette className="h-4 w-4 text-brand" /> Design: brand layouts, PNG export, post</Link>
              <Link href="/studio/video" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-brand-soft"><Clapperboard className="h-4 w-4 text-brand" /> Video clips: long video → captioned shorts</Link>
              <Link href="/studio/voice" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-brand-soft"><AudioLines className="h-4 w-4 text-brand" /> Her voice: clone and voice messages</Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
