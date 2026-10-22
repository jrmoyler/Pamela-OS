import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import type { TranscriptSegment } from "@/lib/db/schema";
import { putFile } from "@/lib/storage";
import { processMeetingNow } from "@/lib/modules/meetings-run";

export const maxDuration = 300;

/** Creates a meeting from a recording (audio + live transcript) and processes it immediately. */
export async function POST(req: Request) {
  const form = await req.formData();
  const audio = form.get("audio");
  const segments = safeParse<TranscriptSegment[]>(form.get("segments"), []);
  const speakers = safeParse<string[]>(form.get("speakers"), []);
  const transcript = String(form.get("transcript") || segments.map((s) => s.text).join(" "));
  let audioFileId: string | null = null;
  if (audio instanceof File && audio.size > 0) {
    const f = await putFile(Buffer.from(await audio.arrayBuffer()), audio.name || "meeting.webm", audio.type || "audio/webm");
    audioFileId = f.id;
  }
  if (!audioFileId && !transcript.trim()) return NextResponse.json({ error: "Nothing was recorded." }, { status: 400 });
  const db = await getDb();
  const [m] = await db
    .insert(schema.meetings)
    .values({
      title: String(form.get("title") || "Meeting"),
      contactId: String(form.get("contactId") || "") || null,
      dealId: String(form.get("dealId") || "") || null,
      attendees: speakers,
      speakers,
      startedAt: form.get("startedAt") ? new Date(String(form.get("startedAt"))) : new Date(),
      durationSec: Math.round(Number(form.get("durationSec") || 0)),
      audioFileId,
      transcript,
      segments,
      status: "processing",
    })
    .returning();
  const job = await processMeetingNow(m.id);
  return NextResponse.json({ id: m.id, job: { status: job?.status, result: job?.result, error: job?.error } });
}

function safeParse<T>(v: FormDataEntryValue | null, fallback: T): T {
  try {
    return v ? (JSON.parse(String(v)) as T) : fallback;
  } catch {
    return fallback;
  }
}
