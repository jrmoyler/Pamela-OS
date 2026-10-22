import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { ClipSuggestion, TranscriptSegment } from "../db/schema";
import { putFile, readFile } from "../storage";
import { transcribe } from "../ai/transcribe";
import { aiJson } from "../ai";
import { emit } from "../events";
import { createApproval } from "../approvals";

/* ───────────── ffmpeg helpers (degrade gracefully when absent, e.g. on Vercel) ───────────── */

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export function hasFfmpeg(): boolean {
  try {
    return spawnSync(FFMPEG, ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[], timeoutMs = 20 * 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function probeDuration(file: string): Promise<number> {
  try {
    const r = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], 60_000);
    const d = parseFloat(r.stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch {
    return 0;
  }
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pamela-video-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/* ───────────── Transcript handling ───────────── */

/** Turns a pasted transcript into timed segments (proportional to word count). */
export function segmentsFromText(text: string, duration: number): TranscriptSegment[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return [];
  const words = sentences.map((s) => s.split(" ").length);
  const total = words.reduce((a, b) => a + b, 0);
  const span = duration > 0 ? duration : total / 2.5; // ~150 wpm
  let t = 0;
  return sentences.map((s, i) => {
    const len = (words[i] / total) * span;
    const seg = { speaker: "Pamela", start: round(t), end: round(t + len), text: s };
    t += len;
    return seg;
  });
}

const round = (n: number) => Math.round(n * 10) / 10;

/* ───────────── Clip scoring ───────────── */

const HOOK_WORDS = /\b(you|your|never|always|secret|truth|why|how|what|stop|mistake|love|god|faith|heart|family|mother|child|pain|healing|hope|fear|free|protect|rights|law|compassion|story|remember)\b/gi;
const EMOTION = /\b(cried|tears|broke|scared|grateful|blessed|angry|hurt|joy|proud|lost|alone|forgive)\b/gi;

/** Deterministic fallback: groups sentence-aligned windows of 15–60s and scores them. */
export function heuristicClips(segments: TranscriptSegment[], duration: number, max = 8): ClipSuggestion[] {
  const out: ClipSuggestion[] = [];
  if (!segments.length) {
    // No transcript at all: evenly spaced 30s windows so she can still cut clips by eye.
    const len = Math.min(30, Math.max(15, duration / 4 || 30));
    const n = Math.max(1, Math.min(max, Math.floor((duration || 90) / len)));
    for (let i = 0; i < n; i++) {
      const start = round(i * len);
      out.push({ id: crypto.randomUUID(), start, end: round(Math.min(duration || start + len, start + len)), score: 50, hook: `Moment ${i + 1}`, caption: "", status: "suggested" });
    }
    return out;
  }
  const windows: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < segments.length; i++) {
    let text = "";
    for (let j = i; j < segments.length; j++) {
      text += (text ? " " : "") + segments[j].text;
      const len = segments[j].end - segments[i].start;
      if (len >= 15 && len <= 60) windows.push({ start: segments[i].start, end: segments[j].end, text });
      if (len > 60) break;
    }
  }
  if (!windows.length) windows.push({ start: segments[0].start, end: segments[segments.length - 1].end, text: segments.map((s) => s.text).join(" ") });
  const scored = windows.map((w) => {
    const first = w.text.split(/(?<=[.!?])\s+/)[0] ?? w.text;
    let score = 40;
    score += Math.min(20, (w.text.match(HOOK_WORDS)?.length ?? 0) * 3);
    score += Math.min(15, (w.text.match(EMOTION)?.length ?? 0) * 5);
    if (/\?/.test(first)) score += 10;
    if (/\d/.test(first)) score += 6;
    const len = w.end - w.start;
    if (len >= 20 && len <= 45) score += 9;
    return { ...w, score: Math.min(99, score), first };
  });
  scored.sort((a, b) => b.score - a.score);
  for (const w of scored) {
    if (out.length >= max) break;
    if (out.some((c) => w.start < c.end && w.end > c.start)) continue; // no overlaps
    out.push({
      id: crypto.randomUUID(),
      start: round(w.start),
      end: round(w.end),
      score: w.score,
      hook: w.first.length > 70 ? w.first.slice(0, 67) + "…" : w.first,
      caption: w.text.length > 220 ? w.text.slice(0, 217) + "…" : w.text,
      status: "suggested",
    });
  }
  return out;
}

export async function scoreClips(segments: TranscriptSegment[], duration: number): Promise<{ clips: ClipSuggestion[]; provider: string }> {
  if (segments.length) {
    const transcript = segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n").slice(0, 24_000);
    const r = await aiJson<{ clips: { start: number; end: number; score: number; hook: string; caption: string }[] }>(
      "agentic",
      "You are a short-form video editor for Pamela of A Cup of Compassion. Find the strongest standalone moments for Reels/Shorts: a clear hook in the first 3 seconds, emotional or practical payoff, 15–60 seconds long, starting and ending on sentence boundaries from the timestamps given. Write the on-screen hook (max 8 words) and a social caption in Pamela's warm voice (no hashtag spam, max 2 hashtags).",
      `Video duration: ${duration.toFixed(1)}s\nTranscript with timestamps:\n${transcript}\n\nReturn {"clips":[{"start":number,"end":number,"score":0-100,"hook":string,"caption":string}]} with up to 8 clips, best first.`,
      2500,
    );
    const valid = (r?.data?.clips ?? [])
      .map((c) => snapToSegments(c, segments))
      .filter((c) => c.end - c.start >= 10 && c.end - c.start <= 75)
      .map((c) => ({ id: crypto.randomUUID(), start: c.start, end: c.end, score: Math.max(0, Math.min(100, Math.round(c.score))), hook: String(c.hook).slice(0, 90), caption: String(c.caption), status: "suggested" as const }));
    if (valid.length) return { clips: valid.sort((a, b) => b.score - a.score), provider: r!.provider };
  }
  return { clips: heuristicClips(segments, duration), provider: "heuristic" };
}

function snapToSegments<T extends { start: number; end: number }>(c: T, segs: TranscriptSegment[]): T {
  const start = segs.reduce((best, s) => (Math.abs(s.start - c.start) < Math.abs(best - c.start) ? s.start : best), segs[0].start);
  const end = segs.reduce((best, s) => (Math.abs(s.end - c.end) < Math.abs(best - c.end) ? s.end : best), segs[segs.length - 1].end);
  return { ...c, start: round(start), end: round(end > start ? end : c.end) };
}

/* ───────────── Jobs ───────────── */

export async function processVideoJob(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const db = await getDb();
  const videoId = String(payload.videoId);
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, videoId));
  if (!video) throw new Error("video not found");
  await db.update(schema.videos).set({ status: "processing", error: null }).where(eq(schema.videos.id, videoId));
  try {
    const pasted = typeof payload.transcript === "string" && payload.transcript.trim() ? payload.transcript.trim() : null;
    let duration = video.durationSec;
    let segments: TranscriptSegment[] = [];
    let transcriptText = pasted ?? "";
    let source = pasted ? "pasted" : "none";
    const src = video.sourceFileId ? await readFile(video.sourceFileId) : null;
    if (src && hasFfmpeg()) {
      await withTemp(async (dir) => {
        const input = path.join(dir, "source" + (path.extname(src.name) || ".mp4"));
        await fs.writeFile(input, src.data);
        duration = (await probeDuration(input)) || duration;
        if (!pasted) {
          const audio = path.join(dir, "audio.mp3");
          const r = await run(FFMPEG, ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", audio]);
          if (r.code === 0) {
            const t = await transcribe(await fs.readFile(audio), "audio.mp3", "audio/mpeg");
            if (t) {
              segments = t.segments.length ? t.segments : segmentsFromText(t.text, duration);
              transcriptText = t.text;
              source = t.provider;
            }
          }
        }
      });
    } else if (src && !pasted) {
      // No ffmpeg (serverless): try sending the original file straight to transcription.
      const t = await transcribe(src.data, src.name, src.mime);
      if (t) {
        segments = t.segments.length ? t.segments : segmentsFromText(t.text, duration);
        transcriptText = t.text;
        source = t.provider;
      }
    }
    if (pasted) segments = segmentsFromText(pasted, duration);
    if (!duration && segments.length) duration = segments[segments.length - 1].end;
    const { clips, provider } = await scoreClips(segments, duration);
    await db
      .update(schema.videos)
      .set({ status: "ready", durationSec: duration, transcript: transcriptText || null, segments, clips, error: null })
      .where(eq(schema.videos.id, videoId));
    await emit("video.processed", { videoId, clipCount: clips.length }, "video");
    return { duration, segments: segments.length, clips: clips.length, transcriptSource: source, scoring: provider };
  } catch (e) {
    await db.update(schema.videos).set({ status: "failed", error: (e as Error).message }).where(eq(schema.videos.id, videoId));
    throw e;
  }
}

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
];

function wrap(text: string, width = 26, maxLines = 4) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

/** Cuts a clip to 9:16 1080x1920 with the hook burned in on a brand-purple band. */
export async function renderClipJob(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const db = await getDb();
  const videoId = String(payload.videoId);
  const clipId = String(payload.clipId);
  const platforms = (Array.isArray(payload.platforms) ? payload.platforms : ["instagram"]) as ("instagram" | "facebook")[];
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, videoId));
  if (!video) throw new Error("video not found");
  const clip = video.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("clip not found");

  let renderedFileId: string | undefined;
  let note = "rendered";
  const src = video.sourceFileId ? await readFile(video.sourceFileId) : null;
  if (src && hasFfmpeg()) {
    renderedFileId = await withTemp(async (dir) => {
      const input = path.join(dir, "source" + (path.extname(src.name) || ".mp4"));
      const out = path.join(dir, "clip.mp4");
      await fs.writeFile(input, src.data);
      const hookFile = path.join(dir, "hook.txt");
      const capFile = path.join(dir, "caption.txt");
      await fs.writeFile(hookFile, wrap(clip.hook.toUpperCase(), 22, 3).join("\n"));
      await fs.writeFile(capFile, wrap(clip.caption || clip.hook, 30, 4).join("\n"));
      const font = FONT_CANDIDATES.find((f) => existsSync(f));
      const fontArg = font ? `fontfile='${font}'` : "font='Sans:style=Bold'";
      const vf = [
        "scale=1080:1920:force_original_aspect_ratio=increase",
        "crop=1080:1920",
        "drawbox=x=0:y=150:w=iw:h=330:color=0x6a1b9a@0.92:t=fill",
        `drawtext=${fontArg}:textfile='${hookFile}':fontcolor=white:fontsize=64:line_spacing=12:x=(w-text_w)/2:y=150+(330-text_h)/2`,
        `drawtext=${fontArg}:textfile='${capFile}':fontcolor=white:fontsize=48:line_spacing=10:box=1:boxcolor=0x6a1b9a@0.85:boxborderw=24:x=(w-text_w)/2:y=h-text_h-260`,
        "drawtext=" + fontArg + ":text='A Cup of Compassion':fontcolor=white:fontsize=36:box=1:boxcolor=0x6a1b9a@0.9:boxborderw=14:x=(w-text_w)/2:y=h-120",
      ].join(",");
      const r = await run(FFMPEG, [
        "-y",
        "-ss",
        String(clip.start),
        "-i",
        input,
        "-t",
        String(Math.max(1, clip.end - clip.start)),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        out,
      ]);
      if (r.code !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-500)}`);
      const file = await putFile(await fs.readFile(out), `${video.title.replace(/[^\w-]+/g, "-").slice(0, 40)}-clip.mp4`, "video/mp4");
      return file.id;
    });
  } else {
    note = "ffmpeg unavailable — the approval will post the original video";
  }

  // Re-read so concurrent edits to other clips aren't lost.
  const [fresh] = await db.select().from(schema.videos).where(eq(schema.videos.id, videoId));
  const clips = (fresh?.clips ?? video.clips).map((c) => (c.id === clipId ? { ...c, status: "approved" as const, renderedFileId: renderedFileId ?? c.renderedFileId } : c));
  await db.update(schema.videos).set({ clips }).where(eq(schema.videos.id, videoId));

  const approval = await createApproval({
    kind: "clip_post",
    title: `Post clip “${clip.hook}” to ${platforms.join(" + ")}`,
    summary: `${video.title} · ${clip.start.toFixed(1)}s–${clip.end.toFixed(1)}s · score ${clip.score}`,
    payload: { videoId, clipId, platforms, caption: clip.caption || clip.hook },
    subjectType: "video",
    subjectId: videoId,
    createdBy: "user",
  });
  return { renderedFileId: renderedFileId ?? null, approvalId: approval.id, note };
}
