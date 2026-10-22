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
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "No audio received" }, { status: 400 });
  const stored = await putFile(Buffer.from(await file.arrayBuffer()), file.name, file.type || "audio/webm");
  await db.update(schema.voiceDrafts).set({ audioFileId: stored.id, status: "draft" }).where(eq(schema.voiceDrafts.id, id));
  return NextResponse.json({ id: stored.id });
}
