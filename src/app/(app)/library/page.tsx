import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { FolderOpen, RefreshCw, Link2 } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { requireSession } from "@/lib/auth";
import { SOURCE_LABELS } from "@/lib/hub/inbox";
import { driveConnected, dropboxConnected, listDrive, listDropbox, type RemoteFile } from "@/lib/hub/sources";
import { PageHeader, Card, CardHeader, Badge, Button, Input, Select, EmptyState, Tabs } from "@/components/ui";
import { LibraryUpload } from "@/components/hub/LibraryUpload";
import { fmtDate } from "@/lib/utils";
import { importLink, pullFromDrive, pullFromDropbox, syncNow } from "./actions";

export const metadata = { title: "Library" };

const size = (n: number | null) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

function RemoteList({ files, pull, folderHref }: { files: RemoteFile[]; pull: (id: string) => Promise<void>; folderHref: (f: RemoteFile) => string }) {
  if (!files.length) return <p className="p-4 text-sm text-zinc-500">Nothing here.</p>;
  return (
    <ul className="divide-y divide-zinc-100">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3 px-4 py-2 text-sm">
          {f.isFolder ? (
            <Link href={folderHref(f)} className="flex items-center gap-2 font-medium text-brand-ink hover:text-brand">
              <FolderOpen className="h-4 w-4 text-brand" /> {f.name}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 truncate text-brand-ink">{f.name}</span>
          )}
          <span className="ml-auto shrink-0 text-xs text-zinc-400">{size(f.size)} {f.modifiedAt ? `· ${fmtDate(f.modifiedAt)}` : ""}</span>
          {!f.isFolder && (
            <form action={pull.bind(null, f.id)}>
              <Button size="sm" variant="soft">Pull in</Button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; kind?: string; source?: string; folder?: string; path?: string; ok?: string; error?: string }>;
}) {
  await requireSession();
  const sp = await searchParams;
  const tab = sp.tab === "gdrive" || sp.tab === "dropbox" ? sp.tab : "all";
  const db = await getDb();
  const tz = await getSetting("timezone");
  const [gd, dbx] = await Promise.all([driveConnected(), dropboxConnected()]);

  let files: (typeof schema.files.$inferSelect)[] = [];
  let remote: RemoteFile[] = [];
  let remoteError: string | null = null;
  const q = (sp.q ?? "").trim();
  if (tab === "all") {
    const like = `%${q}%`;
    files = await db
      .select()
      .from(schema.files)
      .where(
        and(
          q ? or(ilike(schema.files.name, like), ilike(schema.files.description, like), sql`${q} = any(${schema.files.tags})`) : undefined,
          sp.kind ? eq(schema.files.kind, sp.kind) : undefined,
          sp.source ? eq(schema.files.source, sp.source) : undefined,
        ),
      )
      .orderBy(desc(schema.files.createdAt))
      .limit(200);
  } else {
    try {
      if (tab === "gdrive" && gd) remote = await listDrive({ query: q || undefined, folderId: sp.folder || undefined });
      if (tab === "dropbox" && dbx) remote = await listDropbox({ query: q || undefined, path: sp.path || undefined });
    } catch (e) {
      remoteError = (e as Error).message;
    }
  }

  return (
    <>
      <PageHeader
        title="Library"
        subtitle="Every file in one place: your uploads, studio work, Google Drive, Dropbox, links, and whatever Claude, ChatGPT, Meta Muse or Hermes send in."
        actions={
          <form action={syncNow}>
            <Button variant="outline"><RefreshCw className="h-4 w-4" /> Pull new from folders</Button>
          </form>
        }
      />
      {sp.ok && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{sp.ok}</p>}
      {sp.error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{sp.error}</p>}
      <Tabs
        active={`/library?tab=${tab}`}
        tabs={[
          { href: "/library?tab=all", label: "All files" },
          { href: "/library?tab=gdrive", label: "Google Drive" },
          { href: "/library?tab=dropbox", label: "Dropbox" },
        ]}
      />

      {tab === "all" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <form className="flex flex-wrap gap-2 border-b border-zinc-100 p-3">
              <input type="hidden" name="tab" value="all" />
              <Input name="q" defaultValue={q} placeholder="Search name, description or tag" className="min-w-0 flex-1" aria-label="Search" />
              <Select name="kind" defaultValue={sp.kind ?? ""} className="w-auto" aria-label="Kind">
                <option value="">All kinds</option>
                {["document", "image", "video", "audio", "other"].map((k) => <option key={k} value={k}>{k}</option>)}
              </Select>
              <Select name="source" defaultValue={sp.source ?? ""} className="w-auto" aria-label="Source">
                <option value="">All sources</option>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Button variant="outline">Filter</Button>
            </form>
            {files.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={<FolderOpen className="h-8 w-8" />} title="No files match">Upload something, paste a link, or pull from Drive or Dropbox.</EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {files.map((f) => (
                  <li key={f.id} className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <a href={`/api/files/${f.id}`} target="_blank" className="min-w-0 truncate font-medium text-brand-ink hover:text-brand">{f.name}</a>
                      <Badge>{f.kind}</Badge>
                      <Badge tone="brand">{SOURCE_LABELS[f.source] ?? f.source}</Badge>
                      {f.tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>)}
                      <span className="ml-auto text-xs text-zinc-400">{size(f.size)} · {fmtDate(f.createdAt, tz)}</span>
                    </div>
                    {f.description && <p className="text-xs text-zinc-500">{f.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Upload" subtitle="From this device" />
              <LibraryUpload />
            </Card>
            <Card>
              <CardHeader title="Save from a link" subtitle="Any file link, including Google Drive, Docs and Dropbox share links" />
              <form action={importLink} className="space-y-2 p-4">
                <Input name="url" type="url" required placeholder="https://…" aria-label="Link" />
                <Input name="description" placeholder="What is it? (optional)" aria-label="Description" />
                <Button><Link2 className="h-4 w-4" /> Save to Library</Button>
              </form>
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          {(tab === "gdrive" ? gd : dbx) ? (
            <>
              <form className="flex flex-wrap gap-2 border-b border-zinc-100 p-3">
                <input type="hidden" name="tab" value={tab} />
                <Input name="q" defaultValue={q} placeholder={`Search ${tab === "gdrive" ? "Google Drive" : "Dropbox"}`} className="min-w-0 flex-1" aria-label="Search" />
                <Button variant="outline">Search</Button>
                {(sp.folder || sp.path) && <Link href={`/library?tab=${tab}`}><Button type="button" variant="ghost">Back to top</Button></Link>}
              </form>
              {remoteError ? (
                <p className="p-4 text-sm text-red-600">{remoteError}</p>
              ) : (
                <RemoteList
                  files={remote}
                  pull={tab === "gdrive" ? pullFromDrive : pullFromDropbox}
                  folderHref={(f) => (tab === "gdrive" ? `/library?tab=gdrive&folder=${encodeURIComponent(f.id)}` : `/library?tab=dropbox&path=${encodeURIComponent(f.id)}`)}
                />
              )}
            </>
          ) : (
            <div className="p-4">
              <EmptyState icon={<FolderOpen className="h-8 w-8" />} title={`${tab === "gdrive" ? "Google Drive" : "Dropbox"} isn't connected`}>
                Add the keys under <Link href="/settings#connections" className="text-brand underline">Settings → Connections → File sources</Link>. You can also set a folder there that Pamela OS checks every 10 minutes and pulls new files from.
              </EmptyState>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
