import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileText, Trash2 } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { SOURCE_LABELS } from "@/lib/hub/inbox";
import { fileVersionUrl, getFileRecord, isDocx, isTextFile, readFile } from "@/lib/storage";
import { docxParagraphs } from "@/lib/docx";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, buttonVariants } from "@/components/ui";
import { ConfirmSubmit, FileEditor } from "@/components/hub/FileEditor";
import { fmtDate } from "@/lib/utils";
import { editableCopy, removeFile, saveContent, saveDetails } from "./actions";

export const metadata = { title: "File" };

/** Larger text files open read-only in the browser instead of the editor. */
const MAX_EDIT_BYTES = 2 * 1024 * 1024;

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

export default async function FilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const f = await getFileRecord(id);
  if (!f) notFound();
  const tz = await getSetting("timezone");
  const src = fileVersionUrl(f);
  const text = isTextFile(f.mime, f.name) && f.size <= MAX_EDIT_BYTES;
  const docx = isDocx(f.mime, f.name);
  const pdf = f.mime === "application/pdf" || /\.pdf$/i.test(f.name);

  let body: string | null = null;
  let paras: ReturnType<typeof docxParagraphs> = null;
  let missing = false;
  if (text || docx) {
    const data = await readFile(id);
    if (!data) missing = true;
    else if (text) body = data.data.toString("utf8");
    else paras = docxParagraphs(data.data);
  }

  let viewer: React.ReactNode;
  if (missing) {
    viewer = <p className="p-4 text-sm text-red-600">The stored copy of this file couldn&apos;t be found.</p>;
  } else if (body != null) {
    viewer = <FileEditor initial={body} html={/html/.test(f.mime) || /\.html?$/i.test(f.name)} save={saveContent.bind(null, f.id)} />;
  } else if (f.kind === "image" || f.mime.startsWith("image/")) {
    viewer = (
      <div className="flex justify-center bg-zinc-50 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={f.description ?? f.name} className="max-h-[75vh] max-w-full rounded-lg object-contain" />
      </div>
    );
  } else if (f.mime.startsWith("video/")) {
    viewer = <video src={src} controls playsInline className="max-h-[75vh] w-full bg-black" />;
  } else if (f.mime.startsWith("audio/")) {
    viewer = <audio src={src} controls preload="metadata" className="w-full p-4" />;
  } else if (pdf) {
    viewer = <iframe title={f.name} src={src} className="h-[80vh] w-full rounded-b-xl" />;
  } else if (paras) {
    viewer = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 bg-brand-soft/40 px-4 py-2 text-sm">
          <span className="text-zinc-600">Word documents open read-only. Make a copy to edit it here.</span>
          <form action={editableCopy.bind(null, f.id)}>
            <Button size="sm" variant="soft"><FileText className="h-4 w-4" /> Make an editable copy</Button>
          </form>
        </div>
        <article className="max-w-3xl space-y-3 px-6 pb-6 text-[15px] leading-relaxed text-zinc-800">
          {paras.map((p, i) =>
            !p.text.trim() ? null : p.heading ? (
              <p key={i} className={p.heading === 1 ? "pt-2 text-2xl font-bold text-brand-ink" : p.heading === 2 ? "pt-2 text-xl font-semibold text-brand-ink" : "pt-1 text-lg font-semibold text-brand-ink"}>{p.text}</p>
            ) : (
              <p key={i} className={p.list ? "whitespace-pre-wrap pl-5 before:-ml-4 before:mr-2 before:content-['•']" : "whitespace-pre-wrap"}>{p.text}</p>
            ),
          )}
        </article>
      </div>
    );
  } else {
    viewer = (
      <div className="p-4">
        <EmptyState icon={<FileText className="h-8 w-8" />} title={isTextFile(f.mime, f.name) ? "Too large to edit here" : "No preview for this kind of file"}>
          Download it to open it on this device.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <Link href="/library" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Library
      </Link>
      <PageHeader
        title={f.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge>{f.kind}</Badge>
            <Badge tone="brand">{SOURCE_LABELS[f.source] ?? f.source}</Badge>
            {size(f.size)} · added {fmtDate(f.createdAt, tz)}
          </span>
        }
        actions={
          <a href={src} download={f.name} className={buttonVariants({ variant: "outline" })}>
            <Download className="h-4 w-4" /> Download
          </a>
        }
      />
      {sp.ok && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{sp.ok}</p>}
      {sp.error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{sp.error}</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">{viewer}</Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <form action={saveDetails.bind(null, f.id)} className="space-y-3 p-4">
              <Field label="Name"><Input name="name" defaultValue={f.name} required /></Field>
              <Field label="Description"><Input name="description" defaultValue={f.description ?? ""} placeholder="What is it?" /></Field>
              <Field label="Tags" hint="Comma separated"><Input name="tags" defaultValue={f.tags.join(", ")} /></Field>
              <Button variant="outline">Save details</Button>
            </form>
          </Card>
          <Card>
            <CardHeader title="Delete" subtitle="Removes it from the Library for good. Anything that used it keeps working but loses the file." />
            <form action={removeFile.bind(null, f.id)} className="p-4">
              <ConfirmSubmit message={`Delete “${f.name}”? This can't be undone.`}><Trash2 className="h-4 w-4" /> Delete file</ConfirmSubmit>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
