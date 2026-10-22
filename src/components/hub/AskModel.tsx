"use client";

import { useState, useTransition } from "react";
import { Loader2, Inbox, SendHorizontal } from "lucide-react";
import { Button, Select, Textarea } from "@/components/ui";
import { miniMarkdown } from "@/lib/utils";

/** One box to put a question to any of her connected models directly. */
export function AskModel({
  providers,
  ask,
  save,
}: {
  providers: { id: string; label: string; connected: boolean }[];
  ask: (provider: string, prompt: string) => Promise<{ text: string; provider: string } | { error: string }>;
  save: (provider: string, prompt: string, answer: string) => Promise<void>;
}) {
  const first = providers.find((p) => p.connected)?.id ?? providers[0]?.id ?? "";
  const [provider, setProvider] = useState(first);
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<{ text: string; provider: string; prompt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await ask(provider, prompt);
      if ("error" in r) setError(r.error);
      else setAnswer({ ...r, prompt });
    });
  };

  return (
    <div className="space-y-3 p-4">
      <form onSubmit={submit} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Model" className="w-auto">
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.connected ? "" : " (not connected)"}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask anything, e.g. “Outline a 3-email series for the gala”" className="min-h-16" aria-label="Question" />
          <button disabled={pending || !prompt.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white hover:bg-brand-dark disabled:opacity-60" aria-label="Ask">
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
          </button>
        </div>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {answer && (
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{answer.provider}</p>
          <div className="prose prose-sm max-w-none text-sm text-zinc-800" dangerouslySetInnerHTML={{ __html: miniMarkdown(answer.text) }} />
          <Button
            variant="soft"
            size="sm"
            className="mt-2"
            disabled={saved}
            onClick={async () => {
              await save(provider, answer.prompt, answer.text);
              setSaved(true);
            }}
          >
            <Inbox className="h-4 w-4" /> {saved ? "Saved to inbox" : "Save to inbox"}
          </Button>
        </div>
      )}
    </div>
  );
}
