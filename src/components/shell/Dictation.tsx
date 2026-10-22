"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/* Minimal typings for the Web Speech API (not in lib.dom for all browsers). */
type SpeechResultList = { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

export function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function isEditable(el: Element | null): el is Editable {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return ["text", "search", "email", "url", "tel", ""].includes(el.type) && !el.readOnly && !el.disabled;
  return (el as HTMLElement).isContentEditable;
}

/** Inserts text at the caret and notifies React-controlled inputs. */
export function insertIntoField(el: Editable, text: string) {
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const spacer = before && !/\s$/.test(before) ? " " : "";
    const next = before + spacer + text + el.value.slice(end);
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const caret = (before + spacer + text).length;
    el.setSelectionRange(caret, caret);
  } else {
    document.execCommand("insertText", false, text);
  }
}

/**
 * Voice input everywhere: a floating mic (and Ctrl/⌘+Shift+Space) that
 * dictates into whatever field is focused, applies Pamela's custom
 * dictionary and an optional AI cleanup pass, then inserts at the caret.
 */
export function Dictation() {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [cleanup, setCleanup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const target = useRef<Editable | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const finalText = useRef("");

  useEffect(() => {
    setSupported(!!getSpeechRecognition());
    try {
      setCleanup(localStorage.getItem("pamela.dictation.cleanup") !== "0");
    } catch {}
    const onFocus = (e: FocusEvent) => {
      if (isEditable(e.target as Element)) target.current = e.target as Editable;
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  const finish = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      setInterim("");
      if (!text || !target.current) return;
      setBusy(true);
      try {
        const res = await fetch("/api/voice/cleanup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, ai: cleanup }),
        });
        const data = res.ok ? await res.json() : { text };
        insertIntoField(target.current, data.text || text);
      } catch {
        insertIntoField(target.current, text);
      } finally {
        setBusy(false);
      }
    },
    [cleanup],
  );

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    if (!target.current || !document.contains(target.current)) {
      const active = document.activeElement;
      target.current = isEditable(active) ? active : null;
    }
    if (!target.current) {
      setInterim("Click into a field first, then tap the mic.");
      setTimeout(() => setInterim(""), 2500);
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    finalText.current = "";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += res[0].transcript + " ";
        else live += res[0].transcript;
      }
      setInterim((finalText.current + live).trim());
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setInterim(`Mic error: ${e.error}`);
    };
    r.onend = () => {
      setListening(false);
      void finish(finalText.current);
    };
    rec.current = r;
    r.start();
    setListening(true);
  }, [finish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        if (listening) stop();
        else start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, start, stop]);

  if (!supported) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 print:hidden">
      {(interim || busy) && (
        <div className="max-w-sm rounded-xl border border-brand/20 bg-white px-3 py-2 text-sm shadow-lg">
          {busy ? <span className="text-brand">Cleaning up…</span> : interim}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          title={cleanup ? "AI cleanup on" : "AI cleanup off"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const v = !cleanup;
            setCleanup(v);
            try {
              localStorage.setItem("pamela.dictation.cleanup", v ? "1" : "0");
            } catch {}
          }}
          className={cn("grid h-9 w-9 place-items-center rounded-full border bg-white shadow", cleanup ? "border-brand text-brand" : "border-zinc-300 text-zinc-400")}
        >
          <Sparkles className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={listening ? "Stop dictation" : "Start dictation"}
          title="Dictate into the focused field (Ctrl/⌘ + Shift + Space)"
          onMouseDown={(e) => e.preventDefault() /* keep focus in the field */}
          onClick={() => (listening ? stop() : start())}
          className={cn("grid h-12 w-12 place-items-center rounded-full text-white shadow-lg", listening ? "recording-pulse bg-red-600" : "bg-brand hover:bg-brand-dark")}
        >
          {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
