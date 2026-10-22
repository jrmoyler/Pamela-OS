import Link from "next/link";
import { desc } from "drizzle-orm";
import { Clapperboard } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { PageHeader, Card, CardHeader, Badge, EmptyState, statusTone } from "@/components/ui";
import { UploadForm } from "@/components/studio/UploadForm";
import { fmtDuration, timeAgo } from "@/lib/utils";
import { hasFfmpeg } from "@/lib/modules/video";

export const metadata = { title: "Video clips" };

export default async function VideoStudio() {
  const db = await getDb();
  const videos = await db.select().from(schema.videos).orderBy(desc(schema.videos.createdAt)).limit(100);
  const ffmpeg = hasFfmpeg();
  return (
    <>
      <PageHeader title="Video clips" subtitle="Upload a talk, interview or live — get scored short clips with captions. Nothing posts until you approve it." />
      <Card className="mb-6">
        <CardHeader title="New video" subtitle={ffmpeg ? "Clips are cut to 9:16 with burned-in captions." : "Clip rendering runs on the VPS worker (ffmpeg isn't available on this server)."} />
        <UploadForm endpoint="/api/studio/video/upload" accept="video/*" redirectBase="/studio/video" />
      </Card>
      {videos.length === 0 ? (
        <EmptyState icon={<Clapperboard className="h-8 w-8" />} title="No videos yet">Upload your first video above.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => {
            const approved = v.clips.filter((c) => c.status === "approved" || c.status === "posted").length;
            return (
              <Link key={v.id} href={`/studio/video/${v.id}`}>
                <Card className="h-full p-4 transition hover:border-brand/40">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-brand-ink">{v.title}</p>
                    <Badge tone={statusTone(v.status)}>{v.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {v.durationSec ? fmtDuration(v.durationSec) + " · " : ""}
                    {v.clips.length} clips{approved ? ` · ${approved} approved` : ""} · {timeAgo(v.createdAt)}
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
