"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { PhoneCall, PhoneOff, Send, PhoneForwarded } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { testStart, testTurn, testEnd } from "@/app/(app)/receptionist/actions";
import type { CallState } from "@/lib/modules/receptionist";

type Line = { who: "caller" | "receptionist" | "system"; text: string };

/** Drives the real receptionist engine turn by turn — no Twilio needed. */
export function TestConsole() {
  const [from, setFrom] = useState("+15555550123");
  const [callId, setCallId] = useState<string | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [lines]);

  const speak = (t: string) => {
    try {
      const u = new SpeechSynthesisUtterance(t);
      u.rate = 1.02;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {}
  };

  const call = () =>
    start(async () => {
      const r = await testStart(from);
      setCallId(r.callId);
      setState(r.state);
      setLines([{ who: "system", text: `Incoming call from ${from}` }, { who: "receptionist", text: r.reply }]);
      speak(r.reply);
    });

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!callId || !state) return;
    const said = text;
    setText("");
    start(async () => {
      setLines((l) => [...l, { who: "caller", text: said || "(silence)" }]);
      const r = await testTurn(callId, said, state);
      setState(r.state);
      const extra: Line[] = [];
      if (r.action.type === "transfer") extra.push({ who: "system", text: `→ Transferring call to ${r.action.to}` });
      if (r.action.type === "hangup") extra.push({ who: "system", text: "Call ended · summary saved to the call log and contact timeline" });
      setLines((l) => [...l, { who: "receptionist", text: r.reply }, ...extra]);
      speak(r.reply);
      if (r.action.type !== "continue") {
        if (r.action.type === "transfer") await testEnd(r.callId);
        setCallId(null);
        setState(null);
      }
    });
  };

  const hangup = () =>
    start(async () => {
      if (callId) await testEnd(callId);
      setLines((l) => [...l, { who: "system", text: "Caller hung up · summary saved" }]);
      setCallId(null);
      setState(null);
    });

  return (
    <div className="space-y-3 p-4">
      <div className="max-h-80 min-h-40 space-y-2 overflow-y-auto rounded-lg bg-zinc-50 p-3 text-sm">
        {lines.length === 0 && <p className="text-zinc-500">Place a test call to talk to the receptionist exactly as a caller would. Type (or dictate) what the caller says.</p>}
        {lines.map((l, i) =>
          l.who === "system" ? (
            <p key={i} className="flex items-center gap-1 text-center text-xs font-medium text-brand">
              {l.text.startsWith("→") && <PhoneForwarded className="h-3.5 w-3.5" />} {l.text}
            </p>
          ) : (
            <div key={i} className={l.who === "caller" ? "ml-8 rounded-lg bg-white p-2 shadow-sm" : "mr-8 rounded-lg bg-brand-soft p-2 text-brand-ink"}>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{l.who}</span>
              {l.text}
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      {callId ? (
        <form onSubmit={send} className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="What the caller says…" autoFocus disabled={pending} />
          <Button disabled={pending} aria-label="Say"><Send className="h-4 w-4" /></Button>
          <Button type="button" variant="danger" onClick={hangup} disabled={pending} aria-label="Hang up"><PhoneOff className="h-4 w-4" /></Button>
        </form>
      ) : (
        <div className="flex gap-2">
          <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Caller number" className="max-w-48" />
          <Button onClick={call} disabled={pending}><PhoneCall className="h-4 w-4" /> Place test call</Button>
        </div>
      )}
    </div>
  );
}
