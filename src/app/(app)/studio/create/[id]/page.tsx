import { notFound } from "next/navigation";
import { and, arrayContains, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { FlowCanvas } from "@/components/studio/canvas/FlowCanvas";
import { normalizeGraph } from "@/lib/studio/graph";
import { engineStatus } from "@/lib/studio/engines";
import { TEMPLATES } from "@/components/studio/designTemplates";

export const metadata = { title: "Create canvas" };

export default async function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [flow] = await db.select().from(schema.studioFlows).where(eq(schema.studioFlows.id, id));
  if (!flow) notFound();
  const fileCols = { id: schema.files.id, name: schema.files.name, mime: schema.files.mime };
  const [generations, library, brandAssets, voices, status] = await Promise.all([
    db.select().from(schema.studioGenerations).where(eq(schema.studioGenerations.flowId, id)).orderBy(desc(schema.studioGenerations.createdAt)).limit(200),
    db.select(fileCols).from(schema.files).where(eq(schema.files.kind, "image")).orderBy(desc(schema.files.createdAt)).limit(300),
    db.select(fileCols).from(schema.files).where(and(eq(schema.files.kind, "image"), arrayContains(schema.files.tags, ["brand"]))).orderBy(desc(schema.files.createdAt)).limit(60),
    db.select({ id: schema.voiceClones.id, name: schema.voiceClones.name }).from(schema.voiceClones).where(eq(schema.voiceClones.status, "ready")),
    engineStatus(),
  ]);
  const outIds = [...new Set(generations.flatMap((g) => g.outputFileIds))];
  const outFiles = outIds.length ? await db.select(fileCols).from(schema.files).where(inArray(schema.files.id, outIds)) : [];

  return (
    <FlowCanvas
      flow={{ id: flow.id, title: flow.title, graph: normalizeGraph(flow.graph) }}
      generations={generations.map((g) => ({
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
      }))}
      files={outFiles}
      library={library}
      brandAssets={brandAssets}
      voices={voices}
      templates={TEMPLATES.map((t) => ({ key: t.key, name: t.name, photo: t.fields.includes("photo") }))}
      capabilities={status.capabilities}
    />
  );
}
