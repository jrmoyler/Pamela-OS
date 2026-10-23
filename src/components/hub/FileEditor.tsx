"use client";

import { useEffect, useState, useTransition } from "react";
import { Save, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui";

/** Text editor for Library files (notes, Markdown, CSV, JSON, HTML…), with a preview for HTML. */
export function FileEditor({ initial, html, save }: { initial: string; html: boolean; save: (text: string) => Promise<{ ok: true } | { error: string }> }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = text !== saved;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const submit = () =>
    start(async () => {
      const res = await save(text);
      if ("error" in res) return setStatus({ ok: false, msg: res.error });
      setSaved(text);
      setStatus({ ok: true, msg: "Saved." });
    });

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={pending || !dirty}>
          <Save className="h-4 w-4" /> {pending ? "Saving…" : "Save"}
        </Button>
        {html && (
          <Button type="button" variant="outline" onClick={() => setPreview((p) => !p)}>
            {preview ? <><Pencil className="h-4 w-4" /> Edit</> : <><Eye className="h-4 w-4" /> Preview</>}
          </Button>
        )}
        {dirty && !pending && <span className="text-xs text-amber-700">Unsaved changes</span>}
        {status && !dirty && <span className={status.ok ? "text-xs text-emerald-700" : "text-xs text-red-600"}>{status.msg}</span>}
        {status && !status.ok && dirty && <span className="text-xs text-red-600">{status.msg}</span>}
      </div>
      {preview ? (
        <iframe title="Preview" sandbox="" srcDoc={text} className="h-[70vh] w-full rounded-lg border border-zinc-200 bg-white" />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              if (dirty && !pending) submit();
            }
          }}
          spellCheck
          aria-label="File contents"
          className="h-[70vh] w-full resize-y rounded-lg border border-zinc-300 bg-white p-3 font-mono text-sm leading-relaxed focus:border-brand focus:outline-none"
        />
      )}
    </div>
  );
}

/** Submit button that asks first; sits inside a server-action form. */
export function ConfirmSubmit({ message, children }: { message: string; children: React.ReactNode }) {
  return (
    <Button variant="danger" onClick={(e) => !window.confirm(message) && e.preventDefault()}>
      {children}
    </Button>
  );
}
