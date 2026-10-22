"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { putFile } from "@/lib/storage";
import { enqueue, runPendingJobsInline } from "@/lib/jobs";
import { createApproval } from "@/lib/approvals";
import { aiText } from "@/lib/ai";
import { herVoiceSystem } from "@/lib/rj/voice";
import { RELEASE_STEPS } from "@/lib/modules/music";
import { requireSession } from "@/lib/auth";

async function getSong(id: string) {
  const db = await getDb();
  const [s] = await db.select().from(schema.songs).where(eq(schema.songs.id, id));
  if (!s) throw new Error("Song not found");
  return s;
}

export async function createSong(form: FormData) {
  await requireSession();
  const db = await getDb();
  const [s] = await db
    .insert(schema.songs)
    .values({ title: String(form.get("title") || "Untitled"), prompt: String(form.get("prompt") || "") || null, style: String(form.get("style") || "") || null })
    .returning();
  redirect(`/studio/music/${s.id}`);
}

export async function saveSong(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  await db
    .update(schema.songs)
    .set({
      title: String(form.get("title") || "Untitled"),
      prompt: String(form.get("prompt") || "") || null,
      style: String(form.get("style") || "") || null,
      lyrics: String(form.get("lyrics") || "") || null,
    })
    .where(eq(schema.songs.id, id));
  revalidatePath(`/studio/music/${id}`);
}

export async function writeLyrics(id: string, form: FormData) {
  await requireSession();
  await saveSong(id, form);
  const s = await getSong(id);
  const r = await aiText(
    "drafting",
    `${await herVoiceSystem()}\nYou are also a gifted gospel/inspirational songwriter.`,
    `Write song lyrics titled "${s.title}". Theme/brief: ${s.prompt || "compassion, faith and family"}. Style: ${s.style || "soulful inspirational"}.${s.lyrics ? `\nRevise and improve this draft, keeping what works:\n${s.lyrics}` : ""}\nUse section labels like [Verse 1], [Chorus], [Bridge]. Return only the lyrics.`,
    1500,
  );
  if (!r) throw new Error("No AI model is connected — write the lyrics by hand or connect a model in Settings.");
  const db = await getDb();
  await db.update(schema.songs).set({ lyrics: r.text }).where(eq(schema.songs.id, id));
  revalidatePath(`/studio/music/${id}`);
}

export async function generateSong(id: string, form: FormData) {
  await requireSession();
  await saveSong(id, form);
  const db = await getDb();
  await db.update(schema.songs).set({ status: "generating", providerId: null }).where(eq(schema.songs.id, id));
  await enqueue("song.generate", { songId: id });
  if (process.env.INLINE_JOBS !== "0") after(() => runPendingJobsInline(1, ["song.generate"]).then(() => undefined));
  revalidatePath(`/studio/music/${id}`);
}

export async function uploadAudio(id: string, form: FormData) {
  await requireSession();
  const file = form.get("audio");
  if (!(file instanceof File) || !file.size || !file.type.startsWith("audio/")) throw new Error("Choose an audio file.");
  const stored = await putFile(Buffer.from(await file.arrayBuffer()), file.name, file.type);
  const s = await getSong(id);
  const db = await getDb();
  await db
    .update(schema.songs)
    .set({ audioFileId: stored.id, provider: "upload", status: s.status === "idea" || s.status === "failed" || s.status === "generating" ? "draft" : s.status })
    .where(eq(schema.songs.id, id));
  revalidatePath(`/studio/music/${id}`);
}

export async function setStatus(id: string, status: "idea" | "draft" | "approved") {
  await requireSession();
  const db = await getDb();
  await db.update(schema.songs).set({ status }).where(eq(schema.songs.id, id));
  revalidatePath(`/studio/music/${id}`);
}

export async function saveChecklist(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  const checklist = Object.fromEntries(RELEASE_STEPS.map((s) => [s.key, form.get(s.key) === "on"]));
  const cover = String(form.get("coverDesignId") || "") || null;
  const date = String(form.get("releaseDate") || "");
  await db
    .update(schema.songs)
    .set({ releaseChecklist: { ...checklist, cover: checklist.cover || !!cover }, coverDesignId: cover, releaseDate: date ? new Date(date + "T12:00:00") : null })
    .where(eq(schema.songs.id, id));
  revalidatePath(`/studio/music/${id}`);
}

export async function requestRelease(id: string, form: FormData) {
  await requireSession();
  const s = await getSong(id);
  if (!s.audioFileId) throw new Error("Add the audio before releasing.");
  const platforms = form.getAll("platforms").map(String).filter((p): p is "instagram" | "facebook" => p === "instagram" || p === "facebook");
  const caption = String(form.get("caption") || "") || `New music from Pamela: “${s.title}” 💜 A Cup of Compassion`;
  await createApproval({
    kind: "song_release",
    title: `Release “${s.title}”${platforms.length ? ` + announce on ${platforms.join(" + ")}` : ""}`,
    summary: Object.entries(s.releaseChecklist).filter(([, v]) => v).map(([k]) => k).join(", ") || "checklist not started",
    payload: { songId: id, platforms, caption },
    subjectType: "song",
    subjectId: id,
  });
  redirect("/approvals");
}

export async function deleteSong(id: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.songs).where(eq(schema.songs.id, id));
  redirect("/studio/music");
}
