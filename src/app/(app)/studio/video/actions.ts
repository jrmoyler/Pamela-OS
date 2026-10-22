"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ClipSuggestion } from "@/lib/db/schema";
import { enqueue, runPendingJobsInline } from "@/lib/jobs";

async function updateClip(videoId: string, clipId: string, patch: Partial<ClipSuggestion>) {
  const db = await getDb();
  const [v] = await db.select().from(schema.videos).where(eq(schema.videos.id, videoId));
  if (!v) throw new Error("Video not found");
  const clips = v.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c));
  await db.update(schema.videos).set({ clips }).where(eq(schema.videos.id, videoId));
  revalidatePath(`/studio/video/${videoId}`);
}

function runSoon(types: string[]) {
  if (process.env.INLINE_JOBS !== "0") after(() => runPendingJobsInline(1, types).then(() => undefined));
}

export async function saveClip(videoId: string, clipId: string, form: FormData) {
  const start = Math.max(0, Number(form.get("start")));
  const end = Math.max(start + 1, Number(form.get("end")));
  await updateClip(videoId, clipId, { hook: String(form.get("hook") ?? ""), caption: String(form.get("caption") ?? ""), start, end });
}

export async function approveClip(videoId: string, clipId: string, form: FormData) {
  await saveClip(videoId, clipId, form);
  const platforms = form.getAll("platforms").map(String).filter((p) => p === "instagram" || p === "facebook");
  await updateClip(videoId, clipId, { status: "approved" });
  await enqueue("video.render_clip", { videoId, clipId, platforms: platforms.length ? platforms : ["instagram"] });
  runSoon(["video.render_clip"]);
}

export async function rejectClip(videoId: string, clipId: string) {
  await updateClip(videoId, clipId, { status: "rejected" });
}

export async function restoreClip(videoId: string, clipId: string) {
  await updateClip(videoId, clipId, { status: "suggested" });
}

export async function addManualClip(videoId: string, form: FormData) {
  const db = await getDb();
  const [v] = await db.select().from(schema.videos).where(eq(schema.videos.id, videoId));
  if (!v) return;
  const start = Math.max(0, Number(form.get("start") || 0));
  const end = Math.max(start + 5, Number(form.get("end") || start + 30));
  const clip: ClipSuggestion = { id: crypto.randomUUID(), start, end, score: 0, hook: String(form.get("hook") || "New clip"), caption: "", status: "suggested" };
  await db.update(schema.videos).set({ clips: [...v.clips, clip] }).where(eq(schema.videos.id, videoId));
  revalidatePath(`/studio/video/${videoId}`);
}

export async function reprocess(videoId: string, form: FormData) {
  const db = await getDb();
  const transcript = String(form.get("transcript") ?? "").trim();
  await db.update(schema.videos).set({ status: "processing", error: null, ...(transcript ? { transcript } : {}) }).where(eq(schema.videos.id, videoId));
  await enqueue("video.process", { videoId, ...(transcript ? { transcript } : {}) });
  runSoon(["video.process"]);
  revalidatePath(`/studio/video/${videoId}`);
}

export async function deleteVideo(videoId: string) {
  const db = await getDb();
  await db.delete(schema.videos).where(eq(schema.videos.id, videoId));
  redirect("/studio/video");
}
