import Link from "next/link";
import { desc } from "drizzle-orm";
import { Music } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Field, EmptyState, statusTone } from "@/components/ui";
import { sunoConfigured } from "@/lib/modules/music";
import { timeAgo } from "@/lib/utils";
import { createSong } from "./actions";

export const metadata = { title: "Music studio" };

const STAGES = ["idea", "generating", "draft", "approved", "released"] as const;

export default async function MusicStudio() {
  const db = await getDb();
  const songs = await db.select().from(schema.songs).orderBy(desc(schema.songs.createdAt));
  const suno = await sunoConfigured();
  return (
    <>
      <PageHeader title="Music studio" subtitle={suno ? "Suno is connected." : "Suno isn't connected yet — you can still write lyrics with RJ and upload your own audio."} />
      <Card className="mb-6">
        <CardHeader title="New song" />
        <form action={createSong} className="grid gap-3 p-4 md:grid-cols-4">
          <Field label="Title"><Input name="title" required /></Field>
          <Field label="What's it about?" className="md:col-span-2"><Input name="prompt" placeholder="e.g. a mother's prayer over her children" /></Field>
          <Field label="Style"><Input name="style" placeholder="soulful gospel, piano, choir" /></Field>
          <div className="md:col-span-4"><Button>Create</Button></div>
        </form>
      </Card>
      {songs.length === 0 ? (
        <EmptyState icon={<Music className="h-8 w-8" />} title="Your catalog is empty">Start a song above.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          {STAGES.map((stage) => (
            <div key={stage}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{stage}</p>
              <div className="space-y-2">
                {songs
                  .filter((s) => (stage === "idea" ? s.status === "idea" || s.status === "failed" : s.status === stage))
                  .map((s) => (
                    <Link key={s.id} href={`/studio/music/${s.id}`}>
                      <Card className="p-3 transition hover:border-brand/40">
                        <p className="font-serif font-semibold">{s.title}</p>
                        <p className="text-xs text-zinc-500">{s.style || "—"} · {timeAgo(s.createdAt)}</p>
                        {s.status === "failed" && <Badge tone={statusTone("failed")}>generation failed</Badge>}
                      </Card>
                    </Link>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
