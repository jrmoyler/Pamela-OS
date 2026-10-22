"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

/** Records audio in the browser (MediaRecorder) and uploads it to `endpoint` as `file`. */
export function Recorder({ endpoint, label = "Record", extra }: { endpoint: string; label?: string; extra?: Record<string, string> }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "recording" | "recorded" | "uploading">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const blob = useRef<Blob | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const r = new MediaRecorder(stream, { mimeType: mime });
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        blob.current = new Blob(chunks.current, { type: mime });
        setUrl(URL.createObjectURL(blob.current));
        setState("recorded");
      };
      r.start(1000);
      rec.current = r;
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setState("recording");
    } catch {
      setError("Microphone permission is needed to record.");
    }
  };

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stop();
  };

  const upload = async () => {
    if (!blob.current) return;
    setState("uploading");
    const form = new FormData();
    const ext = blob.current.type.includes("webm") ? "webm" : "m4a";
    form.set("file", new File([blob.current], `recording.${ext}`, { type: blob.current.type }));
    for (const [k, v] of Object.entries(extra ?? {})) form.set(k, v);
    const res = await fetch(endpoint, { method: "POST", body: form });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Upload failed");
      setState("recorded");
      return;
    }
    setUrl(null);
    blob.current = null;
    setState("idle");
    router.refresh();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {state !== "recording" ? (
          <Button type="button" size="sm" variant="outline" onClick={start} disabled={state === "uploading"}>
            <Mic className="h-4 w-4" /> {label}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="danger" onClick={stop}>
            <Square className="h-4 w-4" /> Stop ({seconds}s)
          </Button>
        )}
        {state === "recorded" && (
          <Button type="button" size="sm" onClick={upload}>
            <Upload className="h-4 w-4" /> Save recording
          </Button>
        )}
        {state === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
      </div>
      {url && <audio controls src={url} className="w-full" />}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
