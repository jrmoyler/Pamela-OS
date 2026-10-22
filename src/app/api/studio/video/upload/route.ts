import { NextResponse, after } from "next/server";
import { getDb, schema } from "@/lib/db";
import { putFile } from "@/lib/storage";
import { enqueue, runPendingJobsInline } from "@/lib/jobs";

export const maxDuration = 300;

/** Uploads a source video and queues processing (worker or inline). */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose a video file." }, { status: 400 });
  if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) return NextResponse.json({ error: "That isn't a video file." }, { status: 400 });
  const stored = await putFile(Buffer.from(await file.arrayBuffer()), file.name, file.type);
  const db = await getDb();
  const transcript = String(form.get("transcript") ?? "").trim();
  const [video] = await db
    .insert(schema.videos)
    .values({ title: String(form.get("title") || file.name.replace(/\.[^.]+$/, "")), sourceFileId: stored.id, status: "processing", transcript: transcript || null })
    .returning();
  await enqueue("video.process", { videoId: video.id, ...(transcript ? { transcript } : {}) });
  if (process.env.INLINE_JOBS !== "0") after(() => runPendingJobsInline(1, ["video.process"]).then(() => undefined));
  return NextResponse.json({ id: video.id });
}
