import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/** Run history for one canvas, polled by the canvas while nodes are working (session-protected by middleware). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const db = await getDb();
  const generations = await db
    .select()
    .from(schema.studioGenerations)
    .where(eq(schema.studioGenerations.flowId, id))
    .orderBy(desc(schema.studioGenerations.createdAt))
    .limit(200);
  const fileIds = [...new Set(generations.flatMap((g) => g.outputFileIds))];
  const files = fileIds.length
    ? await db.select({ id: schema.files.id, name: schema.files.name, mime: schema.files.mime, kind: schema.files.kind }).from(schema.files).where(inArray(schema.files.id, fileIds))
    : [];
  return NextResponse.json({ generations: generations.map(toClient), files });
}

export type ClientGeneration = ReturnType<typeof toClient>;

function toClient(g: typeof schema.studioGenerations.$inferSelect) {
  return {
    id: g.id,
    nodeId: g.nodeId,
    kind: g.kind,
    status: g.status,
    provider: g.provider,
    model: g.model,
    prompt: g.prompt,
    error: g.error,
    outputFileIds: g.outputFileIds,
    params: g.params,
    createdAt: g.createdAt.toISOString(),
  };
}
