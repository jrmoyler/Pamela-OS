import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { getSecret } from "../settings";
import { putFile } from "../storage";
import { emit } from "../events";

/**
 * Suno generation through Pamela's own Suno API endpoint (SUNO_API_BASE_URL +
 * SUNO_API_KEY). Works with the common self-hosted Suno API shape:
 *   POST {base}/generate  → [{ id, status, audio_url }] (or { data: [...] } / { id })
 *   GET  {base}/feed/{id} or {base}/get?ids={id} → same clip objects
 */
type SunoClip = { id?: string; status?: string; audio_url?: string; audioUrl?: string; title?: string; lyric?: string };

export async function sunoConfigured() {
  return !!(await getSecret("SUNO_API_BASE_URL"));
}

async function suno(path: string, init: RequestInit = {}) {
  const base = await getSecret("SUNO_API_BASE_URL");
  if (!base) throw new Error("Suno isn't connected. Add your Suno API URL and key in Settings → Connections.");
  const key = await getSecret("SUNO_API_KEY");
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Suno ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function clipsOf(data: unknown): SunoClip[] {
  if (Array.isArray(data)) return data as SunoClip[];
  const d = data as { data?: unknown; clips?: unknown; id?: string };
  if (Array.isArray(d?.data)) return d.data as SunoClip[];
  if (Array.isArray(d?.clips)) return d.clips as SunoClip[];
  if (d?.id) return [d as SunoClip];
  return [];
}

const audioOf = (c?: SunoClip) => c?.audio_url || c?.audioUrl || "";

export async function generateSongJob(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const db = await getDb();
  const songId = String(payload.songId);
  const [song] = await db.select().from(schema.songs).where(eq(schema.songs.id, songId));
  if (!song) throw new Error("song not found");
  try {
    let clip = song.providerId ? ({ id: song.providerId } as SunoClip) : undefined;
    if (!clip) {
      const created = clipsOf(
        await suno("/generate", {
          method: "POST",
          body: JSON.stringify({
            prompt: song.lyrics || song.prompt || song.title,
            gpt_description_prompt: song.lyrics ? undefined : song.prompt,
            lyrics: song.lyrics || undefined,
            tags: song.style || undefined,
            style: song.style || undefined,
            title: song.title,
            make_instrumental: false,
            wait_audio: false,
          }),
        }),
      );
      clip = created[0];
      if (!clip?.id && !audioOf(clip)) throw new Error("Suno did not return a song id.");
      await db.update(schema.songs).set({ providerId: clip.id ?? null }).where(eq(schema.songs.id, songId));
    }
    // Poll until the audio is complete (up to ~6 minutes inside one job run).
    let audioUrl = clip.status === "complete" ? audioOf(clip) : "";
    for (let i = 0; !audioUrl && i < 72; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      let latest: SunoClip | undefined;
      try {
        latest = clipsOf(await suno(`/feed/${clip.id}`))[0];
      } catch {
        latest = clipsOf(await suno(`/get?ids=${encodeURIComponent(clip.id!)}`))[0];
      }
      if (latest?.status === "error") throw new Error("Suno reported an error generating this song.");
      if (audioOf(latest) && (latest?.status === "complete" || !latest?.status)) audioUrl = audioOf(latest);
    }
    if (!audioUrl) throw new Error("Suno is still working — try again shortly.");
    const audio = await fetch(audioUrl);
    if (!audio.ok) throw new Error("Could not download the generated audio.");
    const file = await putFile(Buffer.from(await audio.arrayBuffer()), `${song.title.replace(/[^\w-]+/g, "-")}.mp3`, audio.headers.get("content-type") || "audio/mpeg");
    await db.update(schema.songs).set({ status: "draft", audioFileId: file.id, audioUrl: null }).where(eq(schema.songs.id, songId));
    await emit("song.generated", { songId }, "music");
    return { audioFileId: file.id, providerId: clip.id ?? null };
  } catch (e) {
    await db.update(schema.songs).set({ status: "failed" }).where(eq(schema.songs.id, songId));
    throw e;
  }
}

export const RELEASE_STEPS: { key: string; label: string }[] = [
  { key: "master", label: "Final master approved" },
  { key: "cover", label: "Cover art linked" },
  { key: "metadata", label: "Credits & metadata complete" },
  { key: "distribution", label: "Submitted to distributor" },
  { key: "announcement", label: "Announcement caption ready" },
];
