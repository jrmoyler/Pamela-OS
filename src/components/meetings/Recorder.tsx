"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Upload, UserPlus, Loader2, Pause, Play } from "lucide-react";
import { Button, Input, Select, Field, Card, CardHeader, Textarea } from "@/components/ui";
import { getSpeechRecognition } from "@/components/shell/Dictation";
import { fmtDuration, cn } from "@/lib/utils";

type Segment = { speaker: string; start: number; end: number; text: string };
type Opt = { id: string; label: string };

/**
 * Meeting capture: records audio (MediaRecorder) while the browser produces a
 * live transcript. Pamela taps the speaker who's talking so segments get
 * labelled. On stop, audio + transcript upload and are processed immediately.
 */
export function Recorder({ contacts, deals, defaultContactId }: { contacts: Opt[]; deals: Opt[]; defaultContactId?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState(defaultContactId ?? "");
  const [dealId, setDealId] = useState("");
  const [speakers, setSpeakers] = useState<string[]>(["Pamela", "Guest"]);
  const [current, setCurrent] = useState("Pamela");
  const [newSpeaker, setNewSpeaker] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState("");
  const [state, setState] = useState<"idle" | "recording" | "paused" | "uploading">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveSupported, setLiveSupported] = useState(true);
  const [manual, setManual] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [failedUpload, setFailedUpload] = useState<{ blob: Blob | File | null; segs: Segment[]; duration: number } | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<ReturnType<typeof makeRec> | null>(null);
  const startedAt = useRef<number>(0);
  const pausedTotal = useRef(0);
  const pausedAt = useRef(0);
  const segStart = useRef(0);
  const currentRef = useRef(current);
  const stateRef = useRef(state);
  const segmentsRef = useRef<Segment[]>([]);
  currentRef.current = current;
  stateRef.current = state;

  useEffect(() => setLiveSupported(!!getSpeechRecognition()), []);
  // Leaving the page mid-recording must release the mic and stop recognition restarting itself.
  useEffect(
    () => () => {
      stateRef.current = "idle";
      rec.current?.stop();
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setElapsed((Date.now() - startedAt.current - pausedTotal.current) / 1000), 500);
    return () => clearInterval(id);
  }, [state]);

  const now = () => (Date.now() - startedAt.current - pausedTotal.current) / 1000;

  function makeRec() {
    const SR = getSpeechRecognition();
    if (!SR) return null;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const text = res[0].transcript.trim();
          if (text) {
            const end = now();
            const seg = { speaker: currentRef.current, start: Math.max(0, segStart.current), end, text };
            segmentsRef.current = [...segmentsRef.current, seg];
            setSegments((s) => [...s, seg]);
            segStart.current = end;
          }
        } else live += res[0].transcript;
      }
      setInterim(live);
    };
    // Chrome stops recognition after silence; keep it alive while recording.
    r.onend = () => {
      if (stateRef.current === "recording") {
        try {
          r.start();
        } catch {}
      }
    };
    r.onerror = () => {};
    return r;
  }

  async function start() {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("Microphone permission was denied.");
      return;
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const mr = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    mr.start(1000);
    recorder.current = mr;
    startedAt.current = Date.now();
    pausedTotal.current = 0;
    segStart.current = 0;
    segmentsRef.current = [];
    setSegments([]);
    setState("recording");
    stateRef.current = "recording";
    rec.current = makeRec();
    try {
      rec.current?.start();
    } catch {}
  }

  function pause() {
    recorder.current?.pause();
    pausedAt.current = Date.now();
    setState("paused");
    stateRef.current = "paused";
    rec.current?.stop();
  }

  function resume() {
    recorder.current?.resume();
    pausedTotal.current += Date.now() - pausedAt.current;
    segStart.current = now();
    setState("recording");
    stateRef.current = "recording";
    try {
      rec.current?.start();
    } catch {}
  }

  function switchSpeaker(name: string) {
    // Close the running segment at the switch point so labels line up.
    segStart.current = state === "recording" ? now() : segStart.current;
    setCurrent(name);
  }

  async function stopAndSave() {
    const mr = recorder.current;
    // Measure now (the ticker only updates every 500 ms and stops counting while paused).
    const duration = (stateRef.current === "paused" ? pausedAt.current - startedAt.current - pausedTotal.current : Date.now() - startedAt.current - pausedTotal.current) / 1000;
    stateRef.current = "uploading";
    setState("uploading");
    rec.current?.stop();
    let blob: Blob | null = null;
    if (mr && mr.state !== "inactive") {
      await new Promise<void>((res) => {
        mr.onstop = () => res();
        mr.stop();
      });
      blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    setElapsed(duration);
    // Read segments from the ref: final speech results can land after the click.
    await upload(blob, segmentsRef.current, duration);
  }

  async function upload(blob: Blob | File | null, segs: Segment[], duration: number) {
    setState("uploading");
    setFailedUpload(null);
    const fd = new FormData();
    if (blob) fd.append("audio", blob, blob instanceof File ? blob.name : `meeting-${Date.now()}.${(blob.type.split("/")[1] ?? "webm").split(";")[0]}`);
    const extraText = manual.trim();
    const allSegs = extraText && !segs.length ? [{ speaker: current, start: 0, end: duration, text: extraText }] : segs;
    fd.append("segments", JSON.stringify(allSegs));
    fd.append("transcript", allSegs.map((s) => s.text).join(" "));
    fd.append("speakers", JSON.stringify(speakers));
    fd.append("title", title || `Meeting ${new Date().toLocaleDateString()}`);
    fd.append("contactId", contactId);
    fd.append("dealId", dealId);
    fd.append("durationSec", String(Math.round(duration)));
    fd.append("startedAt", new Date(Date.now() - duration * 1000).toISOString());
    try {
      const res = await fetch("/api/meetings", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      router.push(`/meetings/${data.id}`);
    } catch (e) {
      // Keep the recording so a failed upload doesn't lose the meeting.
      setFailedUpload({ blob, segs, duration });
      setError((e as Error).message);
      setState("idle");
    }
  }

  async function uploadFile() {
    if (!file) return;
    const duration = await new Promise<number>((res) => {
      const a = document.createElement("audio");
      a.preload = "metadata";
      const src = URL.createObjectURL(file);
      a.onloadedmetadata = () => {
        URL.revokeObjectURL(src);
        res(Number.isFinite(a.duration) ? a.duration : 0);
      };
      a.onerror = () => {
        URL.revokeObjectURL(src);
        res(0);
      };
      a.src = src;
    });
    await upload(file, [], duration);
  }

  const recording = state === "recording" || state === "paused";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <div className="flex flex-wrap items-center gap-4 p-5">
            <div className={cn("grid h-16 w-16 place-items-center rounded-full text-white", state === "recording" ? "recording-pulse bg-red-600" : "bg-brand")}>
              {state === "uploading" ? <Loader2 className="h-7 w-7 animate-spin" /> : <Mic className="h-7 w-7" />}
            </div>
            <div className="flex-1">
              <p className="text-3xl font-bold tabular-nums text-brand-ink">{fmtDuration(elapsed)}</p>
              <p className="text-sm text-zinc-500">
                {state === "idle" && "Ready to record"}
                {state === "recording" && `Recording · ${current} speaking`}
                {state === "paused" && "Paused"}
                {state === "uploading" && "Saving, transcribing and summarising…"}
              </p>
            </div>
            {state === "idle" && (
              <Button size="lg" onClick={start}>
                <Mic className="h-5 w-5" /> Start recording
              </Button>
            )}
            {recording && (
              <div className="flex gap-2">
                {state === "recording" ? (
                  <Button variant="outline" size="lg" onClick={pause}><Pause className="h-5 w-5" /> Pause</Button>
                ) : (
                  <Button variant="outline" size="lg" onClick={resume}><Play className="h-5 w-5" /> Resume</Button>
                )}
                <Button variant="danger" size="lg" onClick={stopAndSave}><Square className="h-5 w-5" /> Stop &amp; save</Button>
              </div>
            )}
          </div>
          {!liveSupported && <p className="border-t border-zinc-100 px-5 py-2 text-xs text-amber-700">This browser has no live transcription — audio is still recorded and transcribed on the server if Whisper is connected. You can also type notes below.</p>}
          {error && (
            <p className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-5 py-2 text-sm text-red-600">
              {error}
              {state === "idle" && failedUpload && (
                <Button size="sm" variant="outline" onClick={() => void upload(failedUpload.blob, failedUpload.segs, failedUpload.duration)}>
                  <Upload className="h-4 w-4" /> Retry upload
                </Button>
              )}
            </p>
          )}
          <div className="border-t border-zinc-100 px-5 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Who&apos;s speaking? (tap to switch)</p>
            <div className="flex flex-wrap items-center gap-2">
              {speakers.map((s) => (
                <button key={s} onClick={() => switchSpeaker(s)} className={cn("rounded-full border px-3 py-1 text-sm", current === s ? "border-brand bg-brand text-white" : "border-zinc-300 text-zinc-700 hover:border-brand")}>
                  {s}
                </button>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = newSpeaker.trim();
                  if (n && !speakers.includes(n)) setSpeakers([...speakers, n]);
                  setNewSpeaker("");
                }}
                className="flex items-center gap-1"
              >
                <Input value={newSpeaker} onChange={(e) => setNewSpeaker(e.target.value)} placeholder="Add speaker" aria-label="New speaker name" className="h-8 w-32" />
                <Button size="icon" variant="ghost" aria-label="Add speaker"><UserPlus className="h-4 w-4" /></Button>
              </form>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Live transcript" subtitle={`${segments.length} segments`} />
          <div className="max-h-[50vh] space-y-2 overflow-y-auto p-4 text-sm">
            {segments.length === 0 && !interim && <p className="text-zinc-500">Words appear here as people talk.</p>}
            {segments.map((s, i) => (
              <p key={i}>
                <span className="mr-2 text-xs tabular-nums text-zinc-400">{fmtDuration(s.start)}</span>
                <span className="mr-1 font-semibold text-brand">{s.speaker}:</span>
                {s.text}
              </p>
            ))}
            {interim && <p className="italic text-zinc-400">{current}: {interim}</p>}
          </div>
          <div className="border-t border-zinc-100 p-4">
            <Field label="Notes / typed transcript (optional)">
              <Textarea value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Paste or type notes — used if nothing was captured live." className="min-h-20" />
            </Field>
            {!recording && state !== "uploading" && manual.trim() && (
              <Button variant="outline" className="mt-2" onClick={() => upload(null, [], 0)}>Save notes as meeting</Button>
            )}
          </div>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" />
          <div className="space-y-3 p-4">
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Board check-in with Linda" /></Field>
            <Field label="Contact">
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">— none —</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Deal">
              <Select value={dealId} onChange={(e) => setDealId(e.target.value)}>
                <option value="">— none —</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </Select>
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Or upload a recording" subtitle="Zoom/phone recordings: audio or video files." />
          <div className="space-y-2 p-4">
            <input type="file" aria-label="Recording file" accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
            <Button variant="outline" className="w-full" disabled={!file || state !== "idle"} onClick={uploadFile}>
              <Upload className="h-4 w-4" /> Upload &amp; process
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
