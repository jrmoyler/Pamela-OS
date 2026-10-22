import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { putFile } from "@/lib/storage";

/** Pamela records the voice note herself instead of rendering it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const db = await getDb();
  const [draft] = await db.select().from(schema.voiceDrafts).where(eq(schema.voiceDrafts.id, id));
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  // The voice_send approval sends whatever audio the draft holds; don't swap it under a pending/approved send.
  if (draft.status === "awaiting_approval" || draft.status === "approved") {
    return NextResponse.json({ error: "This voice message is waiting on approval. Reject it in Approvals before re-recording." }, { status: 409 });
  }
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "No audio received" }, { status: 400 });
  const stored = await putFile(Buffer.from(await file.arrayBuffer()), file.name, file.type || "audio/webm");
  await db.update(schema.voiceDrafts).set({ audioFileId: stored.id, status: "draft" }).where(eq(schema.voiceDrafts.id, id));
  return NextResponse.json({ id: stored.id });
}
