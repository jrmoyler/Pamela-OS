"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { Button, Input, Textarea, Field } from "@/components/ui";
import { renderDesignSvg, TEMPLATES, FIELD_LABELS } from "./designTemplates";

async function toDataUrl(url: string): Promise<string> {
  const blob = await fetch(url).then((r) => r.blob());
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.readAsDataURL(blob);
  });
}

/** Renders SVG → PNG in the browser (fonts fall back to Georgia/Arial inside the image). */
async function svgToPng(svg: string, w: number, h: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.width = w;
    img.height = h;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Could not render the design"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("export failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function DesignEditor({
  design,
  photoUrl,
  saveAction,
}: {
  design: { id: string; title: string; templateKey: string; fields: Record<string, string> };
  photoUrl?: string;
  saveAction: (form: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const t = TEMPLATES.find((x) => x.key === design.templateKey) ?? TEMPLATES[0];
  const [fields, setFields] = useState<Record<string, string>>(design.fields);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const svg = useMemo(() => renderDesignSvg(t.key, fields, photoUrl), [t.key, fields, photoUrl]);

  const exportPng = async () => {
    setExporting(true);
    setError(null);
    try {
      const form = new FormData();
      // Use the name currently typed in the form, not the one the page loaded with.
      form.set("title", String((formRef.current && new FormData(formRef.current).get("title")) ?? design.title));
      for (const f of t.fields) if (f !== "photo") form.set(f, fields[f] ?? "");
      await saveAction(form); // persist current fields first (clears any stale export)
      const href = photoUrl ? await toDataUrl(photoUrl) : undefined;
      const png = await svgToPng(renderDesignSvg(t.key, fields, href), t.width, t.height);
      const up = new FormData();
      up.set("file", new File([png], "design.png", { type: "image/png" }));
      const res = await fetch(`/api/studio/design/${design.id}/export`, { method: "POST", body: up });
      if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="rounded-xl border border-zinc-200 bg-zinc-100 p-4">
        <div className="mx-auto" style={{ maxWidth: t.height > t.width ? 380 : 560 }} dangerouslySetInnerHTML={{ __html: svg.replace("<svg ", '<svg style="width:100%;height:auto;display:block;border-radius:12px" ') }} />
        <p className="mt-2 text-center text-xs text-zinc-500">
          {t.width}×{t.height} · colors, fonts, name and phone footer are locked to the brand kit
        </p>
      </div>
      <form ref={formRef} action={saveAction} className="space-y-3">
        <Field label="Design name">
          <Input name="title" defaultValue={design.title} />
        </Field>
        {t.fields
          .filter((f) => f !== "photo")
          .map((f) => (
            <Field key={f} label={FIELD_LABELS[f]}>
              {f === "body" ? (
                <Textarea name={f} value={fields[f] ?? ""} onChange={(e) => setFields({ ...fields, [f]: e.target.value })} className="min-h-20" />
              ) : (
                <Input name={f} value={fields[f] ?? ""} onChange={(e) => setFields({ ...fields, [f]: e.target.value })} />
              )}
            </Field>
          ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline">Save</Button>
          <Button type="button" onClick={exportPng} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export PNG
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
