"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button, Input, Textarea, Field } from "@/components/ui";

/** Multipart upload with progress, then routes to the new item. */
export function UploadForm({ endpoint, accept, redirectBase, fields = "video" }: { endpoint: string; accept: string; redirectBase: string; fields?: "video" }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = new FormData(form.current!);
    setError(null);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) setError(res.error ?? "Upload failed");
        else router.push(`${redirectBase}/${res.id}`);
      } catch {
        setError("Upload failed");
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Upload failed — check your connection.");
    };
    xhr.send(data);
  };

  return (
    <form ref={form} onSubmit={submit} className="grid gap-3 p-4 md:grid-cols-2">
      <Field label="Video file">
        <Input type="file" name="file" accept={accept} required className="py-1.5" />
      </Field>
      <Field label="Title">
        <Input name="title" placeholder="e.g. Sunday talk — forgiveness" />
      </Field>
      {fields === "video" && (
        <Field label="Transcript (optional)" hint="Paste one if you have it. Otherwise it's transcribed automatically when a transcription service is connected." className="md:col-span-2">
          <Textarea name="transcript" className="min-h-20" />
        </Field>
      )}
      <div className="flex items-center gap-3 md:col-span-2">
        <Button disabled={progress !== null}>
          <Upload className="h-4 w-4" /> {progress !== null ? `Uploading ${progress}%` : "Upload & find clips"}
        </Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );
}
