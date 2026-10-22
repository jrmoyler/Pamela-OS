"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { SendHorizontal, Loader2 } from "lucide-react";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white hover:bg-brand-dark disabled:opacity-60" aria-label="Send">
      {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
    </button>
  );
}

function Thinking() {
  const { pending } = useFormStatus();
  return pending ? <p className="px-1 pb-2 text-sm text-brand">RJ is working on it…</p> : null;
}

export function Composer({ action, suggestions }: { action: (form: FormData) => Promise<void>; suggestions?: string[] }) {
  const ref = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await action(fd);
        ref.current?.reset();
      }}
      className="sticky bottom-0 bg-gradient-to-t from-[#faf8fc] via-[#faf8fc] pt-3"
    >
      <Thinking />
      {suggestions && (
        <div className="mb-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                if (input.current) input.current.value = s;
                ref.current?.requestSubmit();
              }}
              className="rounded-full border border-brand/25 bg-white px-3 py-1 text-xs text-brand hover:bg-brand-soft"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm focus-within:border-brand">
        <textarea
          ref={input}
          name="text"
          aria-label="Message to RJ"
          rows={2}
          placeholder="Ask RJ anything — or tap the mic and talk."
          className="min-h-11 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none focus-visible:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ref.current?.requestSubmit();
            }
          }}
        />
        <Submit />
      </div>
    </form>
  );
}
