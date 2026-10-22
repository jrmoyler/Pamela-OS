import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Sparkles, Wand2, Trash2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Textarea, Field, Select, statusTone } from "@/components/ui";
import { AutoRefresh } from "@/components/studio/AutoRefresh";
import { fileUrl } from "@/lib/storage";
import { RELEASE_STEPS, sunoConfigured } from "@/lib/modules/music";
import { saveSong, writeLyrics, generateSong, uploadAudio, setStatus, saveChecklist, requestRelease, deleteSong } from "../actions";

export default async function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ids are uuids; anything else would make Postgres throw (500) instead of a 404.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [s] = await db.select().from(schema.songs).where(eq(schema.songs.id, id));
  if (!s) notFound();
  const designs = await db.select({ id: schema.designs.id, title: schema.designs.title }).from(schema.designs).orderBy(desc(schema.designs.updatedAt)).limit(50);
  const [job] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.type, "song.generate"))).orderBy(desc(schema.jobs.createdAt)).limit(1);
  const jobError = job && job.payload.songId === id && job.status !== "done" ? job.error : null;
  const suno = await sunoConfigured();

  return (
    <>
      {s.status === "generating" && <AutoRefresh every={5000} />}
      <PageHeader
        title={s.title}
        subtitle={<Badge tone={statusTone(s.status)}>{s.status}</Badge>}
        actions={<Link href="/studio/music"><Button variant="ghost">Catalog</Button></Link>}
      />
      {jobError && <Card className="mb-4 border-red-200 p-3 text-sm text-red-700">{jobError}</Card>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Song" />
          <form className="space-y-3 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Title"><Input name="title" defaultValue={s.title} /></Field>
              <Field label="Brief"><Input name="prompt" defaultValue={s.prompt ?? ""} /></Field>
              <Field label="Style"><Input name="style" defaultValue={s.style ?? ""} /></Field>
            </div>
            <Field label="Lyrics"><Textarea name="lyrics" defaultValue={s.lyrics ?? ""} className="prose-book min-h-80" /></Field>
            <div className="flex flex-wrap gap-2">
              <Button formAction={saveSong.bind(null, id)} variant="outline">Save</Button>
              <Button formAction={writeLyrics.bind(null, id)} variant="outline"><Sparkles className="h-4 w-4" /> {s.lyrics ? "Polish with RJ" : "Write with RJ"}</Button>
              <Button formAction={generateSong.bind(null, id)} disabled={!suno || s.status === "generating"}><Wand2 className="h-4 w-4" /> {s.status === "generating" ? "Generating…" : "Generate with Suno"}</Button>
            </div>
            {!suno && <p className="text-xs text-zinc-500">Connect your Suno API in Settings → Connections to generate audio here.</p>}
          </form>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Audio" />
            <div className="space-y-3 p-4">
              {s.audioFileId ? <audio controls src={fileUrl(s.audioFileId)} className="w-full" /> : <p className="text-sm text-zinc-500">No audio yet.</p>}
              <form action={uploadAudio.bind(null, id)} className="space-y-2">
                <Input type="file" name="audio" accept="audio/*" className="py-1.5" />
                <Button size="sm" variant="outline">Upload your own</Button>
              </form>
              {s.audioFileId && s.status === "draft" && (
                <form action={setStatus.bind(null, id, "approved")}><Button size="sm">Approve this master</Button></form>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Release pipeline" />
            <form action={saveChecklist.bind(null, id)} className="space-y-2 p-4">
              {RELEASE_STEPS.map((step) => (
                <label key={step.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={step.key} defaultChecked={!!s.releaseChecklist[step.key] || (step.key === "master" && s.status === "approved")} className="accent-brand" />
                  {step.label}
                </label>
              ))}
              <Field label="Cover art">
                <Select name="coverDesignId" defaultValue={s.coverDesignId ?? ""}>
                  <option value="">— none —</option>
                  {designs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </Select>
              </Field>
              <Field label="Release date"><Input type="date" name="releaseDate" defaultValue={s.releaseDate ? s.releaseDate.toISOString().slice(0, 10) : ""} /></Field>
              <Button size="sm" variant="outline">Save checklist</Button>
            </form>
          </Card>
          {s.status !== "released" && (
            <Card>
              <CardHeader title="Release" subtitle="Goes to Approvals first." />
              <form action={requestRelease.bind(null, id)} className="space-y-2 p-4">
                <Textarea name="caption" placeholder="Announcement caption (optional)" className="min-h-16" />
                <div className="flex gap-3 text-sm">
                  <label className="flex items-center gap-1.5"><input type="checkbox" name="platforms" value="instagram" className="accent-brand" /> Instagram</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" name="platforms" value="facebook" className="accent-brand" /> Facebook</label>
                </div>
                <Button size="sm" disabled={!s.audioFileId}>Request release</Button>
              </form>
            </Card>
          )}
          <form action={deleteSong.bind(null, id)}>
            <Button variant="ghost" size="sm" className="text-red-600"><Trash2 className="h-4 w-4" /> Delete song</Button>
          </form>
        </div>
      </div>
    </>
  );
}
