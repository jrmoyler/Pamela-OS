import Link from "next/link";
import { PageHeader, Card, CardHeader, Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { getSetting } from "@/lib/settings";
import { CAPABILITY_LABELS, DEFAULT_MODELS, ENGINE_LABELS, engineStatus, type EngineId } from "@/lib/studio/engines";
import type { Capability } from "@/lib/studio/graph";
import { saveEngines } from "../actions";

export const metadata = { title: "Studio engines" };

const SETUP: Record<EngineId, React.ReactNode> = {
  comfyui: (
    <>
      Open source, runs on her own GPU (a VPS with an NVIDIA card, or a desktop). Install{" "}
      <a className="text-brand underline" href="https://github.com/comfyanonymous/ComfyUI" target="_blank" rel="noreferrer">ComfyUI</a>, download an SDXL or FLUX checkpoint into <code>models/checkpoints</code>, run it with <code>--listen</code>, and put it behind HTTPS (see <code>deploy/Caddyfile</code>). Then set <strong>ComfyUI server URL</strong> and the checkpoint name in Settings → Connections. Text → image works right away; for the rest, paste a workflow below.
    </>
  ),
  replicate: (
    <>
      Hosted copies of the same open models, paid per run (cents per image, more for video). Create a token at replicate.com → Account → API tokens and add it as <strong>Replicate API token</strong>.
    </>
  ),
  fal: (
    <>
      Another host for the open models, often faster for video. Create a key at fal.ai → Dashboard → Keys and add it as <strong>fal API key</strong>.
    </>
  ),
};

export default async function EnginesPage() {
  const [status, studio] = await Promise.all([engineStatus(), getSetting("studio")]);
  const caps = Object.keys(CAPABILITY_LABELS) as Capability[];
  return (
    <>
      <PageHeader
        title="Studio engines"
        subtitle="Which open-source models run each kind of node. Keys live in Settings → Connections (Generative studio)."
        actions={<Link href="/studio"><Button variant="outline" size="sm">Back to Create</Button></Link>}
      />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {(Object.keys(ENGINE_LABELS) as EngineId[]).map((e) => (
          <Card key={e} className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold text-brand-ink">{ENGINE_LABELS[e]}</p>
              <Badge tone={status.engines[e] ? "green" : "default"}>{status.engines[e] ? "connected" : "not set"}</Badge>
            </div>
            <p className="text-xs leading-relaxed text-zinc-600">{SETUP[e]}</p>
          </Card>
        ))}
      </div>
      <Card className="mb-4 flex flex-wrap items-center gap-3 border-brand/30 bg-brand-soft p-4 text-sm text-brand-ink">
        <p className="flex-1">Voice clones use her existing voice setup (ElevenLabs or the open-source Chatterbox server) from Studios → Her voice.</p>
        <Link href="/settings#connections"><Button size="sm" variant="outline">Settings → Connections</Button></Link>
      </Card>

      <form action={saveEngines} className="space-y-4">
        {caps.map((cap) => (
          <Card key={cap}>
            <CardHeader
              title={CAPABILITY_LABELS[cap]}
              subtitle={status.capabilities[cap].length ? `Can run on: ${status.capabilities[cap].map((e) => ENGINE_LABELS[e]).join(", ")}` : "No engine can run this yet"}
            />
            <div className="grid gap-4 p-4 md:grid-cols-3">
              <Field label="Use">
                <Select name={`engine:${cap}`} defaultValue={studio.engines[cap] ?? "auto"}>
                  <option value="auto">Auto (first connected)</option>
                  <option value="comfyui">ComfyUI</option>
                  <option value="replicate">Replicate</option>
                  <option value="fal">fal</option>
                </Select>
              </Field>
              <Field label="Replicate model" hint={`Default ${DEFAULT_MODELS.replicate[cap]}`}>
                <Input name={`model:replicate:${cap}`} defaultValue={studio.models[`replicate:${cap}`] ?? ""} placeholder={DEFAULT_MODELS.replicate[cap]} />
              </Field>
              <Field label="fal model" hint={`Default ${DEFAULT_MODELS.fal[cap]}`}>
                <Input name={`model:fal:${cap}`} defaultValue={studio.models[`fal:${cap}`] ?? ""} placeholder={DEFAULT_MODELS.fal[cap]} />
              </Field>
              <Field
                label="ComfyUI workflow (API format JSON)"
                className="md:col-span-3"
                hint={`${cap === "image" ? "Optional: leave empty to use the built-in SDXL/FLUX workflow. " : ""}Placeholders: {{prompt}} {{negative}} {{seed}} {{width}} {{height}} {{count}} {{scale}} {{image}} {{checkpoint}}. End the workflow with a Save Image or Save Video node.`}
              >
                <Textarea name={`comfy:${cap}`} defaultValue={studio.comfyWorkflows[cap] ?? ""} className="min-h-20 font-mono text-xs" placeholder='{"3": {"class_type": "KSampler", "inputs": {"seed": "{{seed}}", …}}}' />
              </Field>
            </div>
          </Card>
        ))}
        <Button>Save engines</Button>
      </form>
    </>
  );
}
