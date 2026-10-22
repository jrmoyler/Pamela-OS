import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Check, X, RotateCcw, Trash2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Textarea, Field, EmptyState, statusTone } from "@/components/ui";
import { ClipPreview } from "@/components/studio/ClipPreview";
import { AutoRefresh } from "@/components/studio/AutoRefresh";
import { fileUrl } from "@/lib/storage";
import { fmtDuration } from "@/lib/utils";
import { saveClip, approveClip, rejectClip, restoreClip, reprocess, deleteVideo, addManualClip } from "../actions";

export default async function VideoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, id));
  if (!video) notFound();
  const renderJobs = await db.select().from(schema.jobs).where(and(eq(schema.jobs.type, "video.render_clip")));
  const rendering = new Set(renderJobs.filter((j) => j.payload.videoId === id && (j.status === "queued" || j.status === "running")).map((j) => String(j.payload.clipId)));
  const failedRender = new Map(renderJobs.filter((j) => j.payload.videoId === id && j.status === "failed").map((j) => [String(j.payload.clipId), j.error]));
  const approvals = await db.select().from(schema.approvals).where(and(eq(schema.approvals.subjectType, "video"), eq(schema.approvals.subjectId, id)));
  const clips = [...video.clips].sort((a, b) => (a.status === "rejected" ? 1 : 0) - (b.status === "rejected" ? 1 : 0) || b.score - a.score);
  const busy = video.status === "processing" || rendering.size > 0;
  const src = video.sourceFileId ? fileUrl(video.sourceFileId) : "";

  return (
    <>
      {busy && <AutoRefresh />}
      <PageHeader
        title={video.title}
        subtitle={
          <>
            <Badge tone={statusTone(video.status)}>{video.status}</Badge> {video.durationSec ? `· ${fmtDuration(video.durationSec)}` : ""} · {video.clips.length} clips
          </>
        }
        actions={
          <Link href="/studio/video">
            <Button variant="ghost">All videos</Button>
          </Link>
        }
      />
      {video.status === "processing" && <Card className="mb-6 p-4 text-sm text-brand">Transcribing and scoring clips… this page updates on its own.</Card>}
      {video.status === "failed" && <Card className="mb-6 border-red-200 p-4 text-sm text-red-700">Processing failed: {video.error}</Card>}

      <div className="space-y-4">
        {clips.length === 0 && video.status === "ready" && <EmptyState title="No clips found">Paste a transcript below and reprocess, or add a clip by hand.</EmptyState>}
        {clips.map((c, i) => {
          const approval = approvals.find((a) => a.payload.clipId === c.id);
          return (
            <Card key={c.id} className={c.status === "rejected" ? "opacity-60" : ""}>
              <div className="grid gap-4 p-4 md:grid-cols-[220px_1fr]">
                {src ? <ClipPreview src={src} start={c.start} end={c.end} hook={c.hook} caption={c.caption} /> : <div />}
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-brand">#{i + 1}</span>
                    <Badge tone={c.score >= 70 ? "green" : c.score >= 50 ? "amber" : "default"}>score {c.score}</Badge>
                    <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                    {rendering.has(c.id) && <Badge tone="amber">rendering 9:16…</Badge>}
                    {failedRender.get(c.id) && !rendering.has(c.id) && <Badge tone="red">render failed: {failedRender.get(c.id)?.slice(0, 80)}</Badge>}
                    {c.renderedFileId && (
                      <a href={fileUrl(c.renderedFileId)} className="text-xs font-medium text-brand underline">
                        rendered clip
                      </a>
                    )}
                    {approval && (
                      <Link href="/approvals" className="text-xs text-brand underline">
                        post {approval.status}
                      </Link>
                    )}
                  </div>
                  <form className="space-y-2">
                    <Field label="On-screen hook"><Input name="hook" defaultValue={c.hook} /></Field>
                    <Field label="Caption"><Textarea name="caption" defaultValue={c.caption} className="min-h-16" /></Field>
                    <div className="flex flex-wrap items-end gap-2">
                      <Field label="Start (s)"><Input name="start" type="number" step="0.1" defaultValue={c.start} className="w-28" /></Field>
                      <Field label="End (s)"><Input name="end" type="number" step="0.1" defaultValue={c.end} className="w-28" /></Field>
                      <span className="pb-2 text-xs text-zinc-500">{(c.end - c.start).toFixed(1)}s</span>
                    </div>
                    {c.status === "suggested" && (
                      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3">
                        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="platforms" value="instagram" defaultChecked className="accent-brand" /> Instagram Reels</label>
                        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="platforms" value="facebook" className="accent-brand" /> Facebook</label>
                        <Button formAction={approveClip.bind(null, id, c.id)} size="sm"><Check className="h-4 w-4" /> Approve & render</Button>
                        <Button formAction={saveClip.bind(null, id, c.id)} size="sm" variant="outline">Save edits</Button>
                        <Button formAction={rejectClip.bind(null, id, c.id)} size="sm" variant="ghost"><X className="h-4 w-4" /> Reject</Button>
                      </div>
                    )}
                    {c.status === "rejected" && (
                      <Button formAction={restoreClip.bind(null, id, c.id)} size="sm" variant="ghost"><RotateCcw className="h-4 w-4" /> Restore</Button>
                    )}
                    {(c.status === "approved" || c.status === "posted") && (
                      <p className="text-xs text-zinc-500">Approved. The rendered clip waits in Approvals — it only posts when you say yes there.</p>
                    )}
                  </form>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Add a clip by hand" />
          <form action={addManualClip.bind(null, id)} className="flex flex-wrap items-end gap-2 p-4">
            <Field label="Hook"><Input name="hook" /></Field>
            <Field label="Start (s)"><Input name="start" type="number" step="0.1" className="w-24" /></Field>
            <Field label="End (s)"><Input name="end" type="number" step="0.1" className="w-24" /></Field>
            <Button variant="outline">Add</Button>
          </form>
        </Card>
        <Card>
          <CardHeader title="Transcript" subtitle="Paste or correct it, then re-find clips." />
          <form action={reprocess.bind(null, id)} className="space-y-2 p-4">
            <Textarea name="transcript" defaultValue={video.transcript ?? ""} className="prose-book min-h-32" />
            <div className="flex gap-2">
              <Button variant="outline" size="sm">Re-find clips</Button>
            </div>
          </form>
        </Card>
      </div>
      <form action={deleteVideo.bind(null, id)} className="mt-6">
        <Button variant="ghost" size="sm" className="text-red-600"><Trash2 className="h-4 w-4" /> Delete video</Button>
      </form>
    </>
  );
}
