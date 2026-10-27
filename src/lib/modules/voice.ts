import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { getSecret } from "../settings";
import { putFile, readFile } from "../storage";

/**
 * Her voice on demand. Clones are created with ElevenLabs (instant voice clone)
 * or registered against a self-hosted Chatterbox TTS endpoint on the VPS.
 * Rendered audio is only ever a DRAFT — sending goes through a voice_send approval.
 */
export type VoiceProvider = "elevenlabs" | "chatterbox";

export async function voiceProviders(): Promise<VoiceProvider[]> {
  const out: VoiceProvider[] = [];
  if (await getSecret("ELEVENLABS_API_KEY")) out.push("elevenlabs");
  if (await getSecret("CHATTERBOX_URL")) out.push("chatterbox");
  return out;
}

/** Creates (or registers) the clone with the provider. Requires recorded consent. */
export async function createCloneWithProvider(cloneId: string) {
  const db = await getDb();
  const [clone] = await db.select().from(schema.voiceClones).where(eq(schema.voiceClones.id, cloneId));
  if (!clone) throw new Error("Voice not found");
  if (!clone.consentConfirmedAt) throw new Error("Consent must be confirmed before a voice clone is created.");
  if (!clone.sampleFileIds.length) throw new Error("Add at least one voice sample.");

  if (clone.provider === "elevenlabs") {
    const key = await getSecret("ELEVENLABS_API_KEY");
    if (!key) throw new Error("ElevenLabs isn't connected. Add the API key in Settings → Connections.");
    const form = new FormData();
    form.append("name", clone.name);
    form.append("description", "Pamela — A Cup of Compassion (created in Pamela OS with consent)");
    for (const id of clone.sampleFileIds) {
      const f = await readFile(id);
      if (f) form.append("files", new Blob([new Uint8Array(f.data)], { type: f.mime }), f.name);
    }
    const res = await fetch("https://api.elevenlabs.io/v1/voices/add", { method: "POST", headers: { "xi-api-key": key }, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await db.update(schema.voiceClones).set({ status: "failed" }).where(eq(schema.voiceClones.id, cloneId));
      throw new Error(`ElevenLabs ${res.status}: ${data?.detail?.message ?? JSON.stringify(data).slice(0, 200)}`);
    }
    await db.update(schema.voiceClones).set({ providerVoiceId: data.voice_id, status: "ready" }).where(eq(schema.voiceClones.id, cloneId));
    return;
  }
  // Chatterbox clones zero-shot from a reference clip: the first sample is the reference.
  if (!(await getSecret("CHATTERBOX_URL"))) throw new Error("Chatterbox isn't connected. Add the endpoint in Settings → Connections.");
  await db.update(schema.voiceClones).set({ providerVoiceId: clone.sampleFileIds[0], status: "ready" }).where(eq(schema.voiceClones.id, cloneId));
}

async function ttsElevenLabs(voiceId: string, text: string) {
  const key = await getSecret("ELEVENLABS_API_KEY");
  if (!key) throw new Error("ElevenLabs isn't connected.");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.85 } }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { data: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg", ext: "mp3" };
}

async function ttsChatterbox(referenceFileId: string, text: string) {
  const base = await getSecret("CHATTERBOX_URL");
  if (!base) throw new Error("Chatterbox isn't connected.");
  const url = base.includes("/audio/speech") ? base : `${base.replace(/\/$/, "")}/v1/audio/speech`;
  const ref = await readFile(referenceFileId);
  const token = await getSecret("WORKER_TOKEN");
  const form = new FormData();
  form.append("input", text);
  form.append("model", "chatterbox");
  form.append("response_format", "mp3");
  if (ref) form.append("voice_file", new Blob([new Uint8Array(ref.data)], { type: ref.mime }), ref.name);
  const res = await fetch(url, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: form, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Chatterbox ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const mime = res.headers.get("content-type") || "audio/mpeg";
  return { data: Buffer.from(await res.arrayBuffer()), mime, ext: mime.includes("wav") ? "wav" : "mp3" };
}

/** Speaks text in a ready clone's voice. Returns audio only; nothing is sent anywhere. */
export async function speakWithClone(cloneId: string, text: string) {
  const db = await getDb();
  const [clone] = await db.select().from(schema.voiceClones).where(eq(schema.voiceClones.id, cloneId));
  if (!clone || clone.status !== "ready" || !clone.providerVoiceId) throw new Error("That voice isn't ready yet.");
  const audio = clone.provider === "elevenlabs" ? await ttsElevenLabs(clone.providerVoiceId, text) : await ttsChatterbox(clone.providerVoiceId, text);
  return { ...audio, provider: clone.provider };
}

export async function renderVoiceJob(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const db = await getDb();
  const draftId = String(payload.draftId);
  const [draft] = await db.select().from(schema.voiceDrafts).where(eq(schema.voiceDrafts.id, draftId));
  if (!draft) throw new Error("draft not found");
  try {
    if (!draft.voiceCloneId) throw new Error("Pick a voice for this draft.");
    const audio = await speakWithClone(draft.voiceCloneId, draft.script);
    const file = await putFile(audio.data, `voice-draft-${draftId.slice(0, 8)}.${audio.ext}`, audio.mime);
    await db.update(schema.voiceDrafts).set({ audioFileId: file.id, status: "draft" }).where(eq(schema.voiceDrafts.id, draftId));
    return { audioFileId: file.id, provider: audio.provider };
  } catch (e) {
    await db.update(schema.voiceDrafts).set({ status: "failed" }).where(eq(schema.voiceDrafts.id, draftId));
    throw e;
  }
}
