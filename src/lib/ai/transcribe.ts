import { getSecret } from "../settings";
import type { TranscriptSegment } from "../db/schema";

export type Transcription = { text: string; segments: TranscriptSegment[]; provider: string };

/**
 * Server-side transcription. Prefers the self-hosted Whisper on the VPS, then
 * OpenAI Whisper. Returns null when neither is configured — the browser's live
 * Web Speech transcript is used in that case.
 */
export async function transcribe(audio: Buffer, filename: string, mime: string): Promise<Transcription | null> {
  const vps = await getSecret("WHISPER_URL");
  const openaiKey = await getSecret("OPENAI_API_KEY");
  const targets: { url: string; key?: string; model: string; provider: string }[] = [];
  if (vps) targets.push({ url: vps.replace(/\/$/, "") + (vps.includes("/audio/transcriptions") ? "" : "/audio/transcriptions"), key: await getSecret("WORKER_TOKEN"), model: "whisper-1", provider: "vps-whisper" });
  if (openaiKey) targets.push({ url: "https://api.openai.com/v1/audio/transcriptions", key: openaiKey, model: "whisper-1", provider: "openai-whisper" });
  for (const t of targets) {
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
      form.append("model", t.model);
      form.append("response_format", "verbose_json");
      const res = await fetch(t.url, {
        method: "POST",
        headers: t.key ? { authorization: `Bearer ${t.key}` } : {},
        body: form,
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const data = await res.json();
      const segments: TranscriptSegment[] = (data.segments ?? []).map((s: { start: number; end: number; text: string; speaker?: string }) => ({
        speaker: s.speaker ?? "Speaker",
        start: s.start,
        end: s.end,
        text: String(s.text).trim(),
      }));
      return { text: data.text ?? segments.map((s) => s.text).join(" "), segments, provider: t.provider };
    } catch (e) {
      console.warn(`[transcribe] ${t.provider} failed`, (e as Error).message);
    }
  }
  return null;
}
