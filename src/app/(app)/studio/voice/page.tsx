import { desc, inArray } from "drizzle-orm";
import { ShieldCheck, Trash2, Sparkles } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Textarea, Field, Select, statusTone } from "@/components/ui";
import { Recorder } from "@/components/studio/Recorder";
import { AutoRefresh } from "@/components/studio/AutoRefresh";
import { fileUrl } from "@/lib/storage";
import { contactName } from "@/lib/crm";
import { voiceProviders } from "@/lib/modules/voice";
import { timeAgo } from "@/lib/utils";
import { createClone, activateClone, deleteClone, createDraft, updateScript, renderDraft, requestSend, deleteDraft } from "./actions";

export const metadata = { title: "Her voice" };

const PURPOSES = { voice_note: "Personal voice note", voicemail_drop: "Voicemail drop", podcast: "Podcast / intro", social: "Social audio" } as const;

export default async function VoiceStudio() {
  const db = await getDb();
  const [clones, drafts, contacts, providers] = await Promise.all([
    db.select().from(schema.voiceClones).orderBy(desc(schema.voiceClones.createdAt)),
    db.select().from(schema.voiceDrafts).orderBy(desc(schema.voiceDrafts.createdAt)).limit(50),
    db.select().from(schema.contacts).orderBy(schema.contacts.firstName).limit(500),
    voiceProviders(),
  ]);
  const draftContacts = drafts.map((d) => d.contactId).filter(Boolean) as string[];
  const byId = new Map((draftContacts.length ? await db.select().from(schema.contacts).where(inArray(schema.contacts.id, draftContacts)) : []).map((c) => [c.id, c]));
  const readyClones = clones.filter((c) => c.status === "ready");
  const rendering = drafts.some((d) => d.status === "rendering");

  return (
    <>
      {rendering && <AutoRefresh />}
      <PageHeader title="Her voice" subtitle="Voice messages in Pamela's voice — always drafts. Nothing is sent, played or posted without her approval." />
      <Card className="mb-6 flex items-start gap-3 border-brand/30 bg-brand-soft p-4 text-sm text-brand-ink">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <p>
          Strict approval: every voice message waits in Approvals with its script and audio.{" "}
          {providers.length ? (
            `Connected: ${providers.join(", ")}.`
          ) : (
            <strong>No voice provider is connected — add ElevenLabs or a Chatterbox endpoint in Settings → Connections to render, or record notes yourself below.</strong>
          )}
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Voices" />
            <ul className="divide-y divide-zinc-100">
              {clones.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">No voice clone yet.</li>}
              {clones.map((c) => (
                <li key={c.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-zinc-500">
                        {c.provider} · {c.sampleFileIds.length} sample{c.sampleFileIds.length === 1 ? "" : "s"} · consent {c.consentConfirmedAt ? "✓" : "missing"}
                      </p>
                    </div>
                    <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                  </div>
                  {c.status !== "ready" && (
                    <>
                      <Recorder endpoint={`/api/studio/voice/clones/${c.id}/samples`} label="Record a sample" />
                      <form action={activateClone.bind(null, c.id)}>
                        <Button size="sm" disabled={!providers.includes(c.provider as "elevenlabs" | "chatterbox") || !c.sampleFileIds.length}>
                          Create voice with {c.provider}
                        </Button>
                      </form>
                    </>
                  )}
                  <form action={deleteClone.bind(null, c.id)}>
                    <button className="text-xs text-red-600">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="New voice clone" subtitle="1–3 minutes of clean speech works best." />
            <form action={createClone} className="space-y-3 p-4">
              <Field label="Name"><Input name="name" defaultValue="Pamela" /></Field>
              <Field label="Provider">
                <Select name="provider">
                  <option value="elevenlabs">ElevenLabs</option>
                  <option value="chatterbox">Chatterbox (VPS)</option>
                </Select>
              </Field>
              <Field label="Samples (optional — you can also record after)"><Input type="file" name="samples" accept="audio/*" multiple className="py-1.5" /></Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" required className="mt-1 accent-brand" />
                <span>I am Pamela (or have her written permission), and I consent to creating a synthetic copy of this voice for use only inside Pamela OS, with approval on every use.</span>
              </label>
              <Button size="sm">Create</Button>
            </form>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="New voice message" />
            <form action={createDraft} className="grid gap-3 p-4 md:grid-cols-3">
              <Field label="Voice">
                <Select name="voiceCloneId">
                  <option value="">Record it myself</option>
                  {readyClones.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="To">
                <Select name="contactId">
                  <option value="">— no contact —</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
                </Select>
              </Field>
              <Field label="Purpose">
                <Select name="purpose">
                  {Object.entries(PURPOSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Script (or what it should say)" className="md:col-span-3"><Textarea name="script" className="prose-book" /></Field>
              <div className="flex gap-2 md:col-span-3">
                <Button>Save draft</Button>
                <Button name="assist" value="1" variant="outline"><Sparkles className="h-4 w-4" /> RJ writes the script</Button>
              </div>
            </form>
          </Card>
          {drafts.map((d) => {
            const c = d.contactId ? byId.get(d.contactId) : undefined;
            const clone = clones.find((x) => x.id === d.voiceCloneId);
            return (
              <Card key={d.id}>
                <CardHeader
                  title={`${PURPOSES[d.purpose as keyof typeof PURPOSES] ?? d.purpose}${c ? ` · ${contactName(c)}` : ""}`}
                  subtitle={`${clone ? clone.name : "self-recorded"} · ${timeAgo(d.createdAt)}`}
                  action={<Badge tone={statusTone(d.status)}>{d.status.replace("_", " ")}</Badge>}
                />
                <div className="grid gap-4 p-4 md:grid-cols-2">
                  <form action={updateScript.bind(null, d.id)} className="space-y-2">
                    <Textarea name="script" defaultValue={d.script} className="prose-book min-h-28" />
                    <Button size="sm" variant="outline">Update script</Button>
                  </form>
                  <div className="space-y-3">
                    {d.audioFileId ? <audio controls src={fileUrl(d.audioFileId)} className="w-full" /> : <p className="text-sm text-zinc-500">No audio yet.</p>}
                    {clone && (
                      <form action={renderDraft.bind(null, d.id)}>
                        <Button size="sm" variant="outline" disabled={d.status === "rendering" || clone.status !== "ready"}>
                          {d.status === "rendering" ? "Rendering…" : `Render in ${clone.name}'s voice`}
                        </Button>
                      </form>
                    )}
                    <Recorder endpoint={`/api/studio/voice/drafts/${d.id}/audio`} label="Record it myself" />
                    {d.audioFileId && d.status !== "sent" && d.status !== "awaiting_approval" && (
                      <form action={requestSend.bind(null, d.id)} className="space-y-2 border-t border-zinc-100 pt-3">
                        <div className="flex gap-2">
                          <Input name="to" defaultValue={c?.phone ?? ""} placeholder="+1…" />
                          <Select name="channel" className="max-w-36">
                            <option value="sms">Text (MMS)</option>
                            <option value="call">Call drop</option>
                          </Select>
                        </div>
                        <Button size="sm">Send for approval</Button>
                      </form>
                    )}
                    <form action={deleteDraft.bind(null, d.id)}>
                      <button className="text-xs text-red-600"><Trash2 className="inline h-3 w-3" /> Delete</button>
                    </form>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
