"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button, Input } from "@/components/ui";

/** Multi-file upload into the Library, with progress. */
export function LibraryUpload() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/library/upload");
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status >= 400) {
        try {
          setError(JSON.parse(xhr.responseText).error ?? "Upload failed");
        } catch {
          setError("Upload failed");
        }
        return;
      }
      form.current?.reset();
      router.refresh();
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Upload failed — check your connection.");
    };
    xhr.send(new FormData(form.current!));
  };

  return (
    <form ref={form} onSubmit={submit} className="space-y-2 p-4">
      <Input type="file" name="file" multiple required className="py-1.5" aria-label="Files" />
      <Input name="description" placeholder="What is it? (optional)" aria-label="Description" />
      <Input name="tags" placeholder="Tags, comma separated (optional)" aria-label="Tags" />
      <div className="flex items-center gap-3">
        <Button disabled={progress !== null}>
          <Upload className="h-4 w-4" /> {progress !== null ? `Uploading ${progress}%` : "Upload"}
        </Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );
}
