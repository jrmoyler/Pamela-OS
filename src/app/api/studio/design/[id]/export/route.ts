import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { putFile } from "@/lib/storage";

/** Receives the browser-rendered PNG of a design and stores it as the export. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const db = await getDb();
  const [design] = await db.select().from(schema.designs).where(eq(schema.designs.id, id));
  if (!design) return NextResponse.json({ error: "not found" }, { status: 404 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.type !== "image/png") return NextResponse.json({ error: "Expected a PNG" }, { status: 400 });
  const stored = await putFile(Buffer.from(await file.arrayBuffer()), `${design.title.replace(/[^\w-]+/g, "-").slice(0, 50) || "design"}.png`, "image/png");
  await db.update(schema.designs).set({ exportFileId: stored.id, updatedAt: new Date() }).where(eq(schema.designs.id, id));
  return NextResponse.json({ id: stored.id });
}
