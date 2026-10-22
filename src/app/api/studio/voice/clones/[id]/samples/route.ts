import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { putFile } from "@/lib/storage";

/** Adds a recorded/uploaded sample to a voice clone. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const db = await getDb();
  const [clone] = await db.select().from(schema.voiceClones).where(eq(schema.voiceClones.id, id));
  if (!clone) return NextResponse.json({ error: "not found" }, { status: 404 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "No audio received" }, { status: 400 });
  const stored = await putFile(Buffer.from(await file.arrayBuffer()), file.name, file.type || "audio/webm");
  await db.update(schema.voiceClones).set({ sampleFileIds: [...clone.sampleFileIds, stored.id] }).where(eq(schema.voiceClones.id, id));
  return NextResponse.json({ id: stored.id });
}
