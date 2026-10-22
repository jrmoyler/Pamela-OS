"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Users } from "lucide-react";

/** Tag/relationship audience with a live count of reachable recipients. */
export function AudiencePicker({
  initial,
  relationshipTypes,
  channel: initialChannel,
  count,
  disabled,
}: {
  initial: string[];
  relationshipTypes: string[];
  channel: string;
  count: (tags: string[], channel: string) => Promise<number>;
  disabled?: boolean;
}) {
  const [rels, setRels] = useState(initial.filter((t) => relationshipTypes.includes(t)));
  const [tags, setTags] = useState(initial.filter((t) => !relationshipTypes.includes(t)).join(", "));
  const [channel, setChannel] = useState(initialChannel);
  const [n, setN] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const all = [
        ...new Set([
          ...tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          ...rels,
        ]),
      ];
      start(async () => setN(await count(all, channel)));
    }, 300);
  }, [tags, rels, channel, count]);

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Channel</p>
        <select name="channel" value={channel} disabled={disabled} onChange={(e) => setChannel(e.target.value)} className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm">
          <option value="email">Email</option>
          <option value="sms">Text message</option>
        </select>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Relationships</p>
        <div className="flex flex-wrap gap-1.5">
          {relationshipTypes.map((r) => (
            <label key={r} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand">
              <input
                type="checkbox"
                name="rel"
                value={r}
                disabled={disabled}
                checked={rels.includes(r)}
                onChange={(e) => setRels((cur) => (e.target.checked ? [...cur, r] : cur.filter((x) => x !== r)))}
                className="accent-brand"
              />
              {r}
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Tags</p>
        <input name="tags" value={tags} disabled={disabled} onChange={(e) => setTags(e.target.value)} placeholder="Comma separated — blank = everyone" className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm" />
      </div>
      <p className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm font-medium text-brand">
        <Users className="h-4 w-4" />
        {n == null || pending ? "Counting…" : `${n} ${n === 1 ? "person" : "people"} will receive this`}
      </p>
      <p className="text-xs text-zinc-500">People marked “do not contact” and anyone without a {channel === "sms" ? "phone number" : "email"} are skipped.</p>
    </div>
  );
}
