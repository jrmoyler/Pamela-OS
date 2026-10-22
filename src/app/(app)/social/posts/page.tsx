import { desc, eq } from "drizzle-orm";
import { Sparkles, Trash2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, CardHeader, Badge, Textarea, Button, Field, Input, statusTone } from "@/components/ui";
import { SocialTabs } from "@/components/social/SocialTabs";
import { fmtDate } from "@/lib/utils";
import { createPost, draftCaption, deletePost } from "../actions";

export const metadata = { title: "Social posts" };

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ caption?: string }> }) {
  const { caption } = await searchParams;
  const db = await getDb();
  const [posts, tz] = await Promise.all([
    db
      .select({ p: schema.socialPosts, f: schema.files })
      .from(schema.socialPosts)
      .leftJoin(schema.files, eq(schema.socialPosts.mediaFileId, schema.files.id))
      .orderBy(desc(schema.socialPosts.createdAt))
      .limit(100),
    getSetting("timezone"),
  ]);
  return (
    <>
      <PageHeader title="Social & DMs" subtitle="Compose once, approve, and it posts to Instagram and Facebook." />
      <SocialTabs active="/social/posts" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="New post" />
            <form action={createPost} className="space-y-3 p-4">
              <Field label="Caption">
                <Textarea name="caption" defaultValue={caption ?? ""} className="min-h-36 font-serif" required />
              </Field>
              <Field label="Photo or video" hint="Required for Instagram.">
                <input type="file" name="media" accept="image/*,video/*" className="block w-full text-sm" />
              </Field>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Post to</p>
                  <div className="flex gap-3 text-sm">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="platforms" value="instagram" defaultChecked className="accent-brand" /> Instagram
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="platforms" value="facebook" defaultChecked className="accent-brand" /> Facebook
                    </label>
                  </div>
                </div>
                <Field label="Schedule (optional)">
                  <Input type="datetime-local" name="scheduledFor" />
                </Field>
              </div>
              <Button>Send for approval</Button>
            </form>
          </Card>
          <Card>
            <CardHeader title="Posts" />
            <ul className="divide-y divide-zinc-100">
              {posts.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">No posts yet.</li>}
              {posts.map(({ p, f }) => (
                <li key={p.id} className="flex gap-3 px-4 py-3">
                  {f &&
                    (f.kind === "video" ? (
                      <video src={`/api/files/${f.id}`} className="h-16 w-16 rounded-lg bg-black object-cover" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${f.id}`} alt="" className="h-16 w-16 rounded-lg object-cover" />
                    ))}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand">{p.platform}</Badge>
                      <Badge tone={statusTone(p.status)}>{p.status.replace("_", " ")}</Badge>
                      <span className="text-xs text-zinc-500">
                        {p.publishedAt ? `published ${fmtDate(p.publishedAt, tz)}` : p.scheduledFor ? `scheduled ${fmtDate(p.scheduledFor, tz)}` : fmtDate(p.createdAt, tz)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-zinc-700">{p.caption}</p>
                  </div>
                  {p.status !== "published" && (
                    <form action={deletePost.bind(null, p.id)}>
                      <Button size="icon" variant="ghost" className="text-red-600" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="Ask RJ for a caption" />
          <form action={draftCaption} className="space-y-3 p-4">
            <Textarea name="about" placeholder="What's the post about? e.g. Saturday's free workshop on wills for young families" className="min-h-24" />
            <Button variant="outline" className="w-full">
              <Sparkles className="h-4 w-4" /> Draft caption
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
