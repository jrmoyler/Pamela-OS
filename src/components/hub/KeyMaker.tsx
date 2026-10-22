"use client";

import { useState, useTransition } from "react";
import { Copy, Check, KeyRound } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";

type Made = { token: string; mcpUrl: string; mcpUrlWithKey: string; inboxUrl: string; client: string };

const DEFAULT_SCOPES: Record<string, string[]> = {
  claude: ["read", "write"],
  chatgpt: ["read", "write"],
  meta: ["write"],
  hermes: ["read", "write", "computer"],
  other: ["write"],
};

function CopyBox({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <div className="flex items-start gap-1">
        <code className="block min-w-0 flex-1 whitespace-pre-wrap break-all rounded bg-zinc-50 px-2 py-1 text-xs">{value}</code>
        <button
          type="button"
          className="rounded p-1 text-brand hover:bg-brand-soft"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Setup({ m }: { m: Made }) {
  const hermesYaml = `mcp_servers:\n  pamela_os:\n    url: "${m.mcpUrl}"\n    headers:\n      Authorization: "Bearer ${m.token}"`;
  const curl = `curl -X POST ${m.inboxUrl} \\\n  -H "Authorization: Bearer ${m.token}" \\\n  -F file=@report.pdf -F description="From Meta Muse"`;
  switch (m.client) {
    case "claude":
      return (
        <div className="space-y-2 text-sm">
          <p>In Claude: <b>Settings → Connectors → Add custom connector</b>. Name it “Pamela OS” and paste this URL:</p>
          <CopyBox label="Connector URL (contains the key, keep it private)" value={m.mcpUrlWithKey} />
          <p className="text-xs text-zinc-500">Claude Code: <code>claude mcp add --transport http pamela-os {m.mcpUrl} --header &quot;Authorization: Bearer {m.token}&quot;</code></p>
        </div>
      );
    case "chatgpt":
      return (
        <div className="space-y-2 text-sm">
          <p>In ChatGPT: <b>Settings → Apps &amp; Connectors → Advanced → Developer mode</b>, then <b>Create</b> a connector with this MCP URL and no authentication:</p>
          <CopyBox label="MCP server URL (contains the key, keep it private)" value={m.mcpUrlWithKey} />
        </div>
      );
    case "hermes":
      return (
        <div className="space-y-2 text-sm">
          <p>Add Pamela OS to Hermes&apos;s config (<code>~/.hermes/config.yaml</code>) and restart Hermes:</p>
          <CopyBox label="config.yaml" value={hermesYaml} />
          <p>So Hermes picks up computer tasks on its own (pull mode), give it a scheduled job, e.g. every 2 minutes: “Call pamela_os next_computer_task. If there is a task, do it following its rules, push any files with push_file, then call finish_computer_task.”</p>
        </div>
      );
    default:
      return (
        <div className="space-y-2 text-sm">
          <p>Anything that can make a web request can push here. Use the MCP URL if the app speaks MCP; otherwise post to the inbox:</p>
          <CopyBox label="MCP URL" value={m.mcpUrlWithKey} />
          <CopyBox label="Push a file (REST)" value={curl} />
          <p className="text-xs text-zinc-500">JSON works too: <code>{`{"title": "…", "body": "…"}`}</code> for a note, or <code>{`{"name": "x.pdf", "url": "https://…"}`}</code> for a file.</p>
        </div>
      );
  }
}

export function KeyMaker({ create }: { create: (name: string, client: string, scopes: string[]) => Promise<(Omit<Made, "client"> & { id: string }) | { error: string }> }) {
  const [client, setClient] = useState("claude");
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES.claude);
  const [name, setName] = useState("");
  const [made, setMade] = useState<Made | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4 p-4">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await create(name, client, scopes);
            if ("error" in r) setError(r.error);
            else setMade({ ...r, client });
          });
        }}
      >
        <Field label="Agent">
          <Select
            value={client}
            onChange={(e) => {
              setClient(e.target.value);
              setScopes(DEFAULT_SCOPES[e.target.value] ?? ["write"]);
              setMade(null);
            }}
          >
            <option value="claude">Claude</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="meta">Meta Muse</option>
            <option value="hermes">Hermes Agent (her computer)</option>
            <option value="other">Other app or shortcut</option>
          </Select>
        </Field>
        <Field label="Name (optional)">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude on my laptop" />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">It may</legend>
          {[
            ["read", "Read her contacts, tasks, calendar and files"],
            ["write", "Push files and notes, add tasks, draft messages (drafts wait in Approvals)"],
            ["computer", "Ask Hermes to use her computer (each request waits for her yes)"],
          ].map(([s, label]) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button disabled={pending}>
            <KeyRound className="h-4 w-4" /> {pending ? "Creating…" : "Create key"}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </form>
      {made && (
        <div className="space-y-3 rounded-lg border border-brand/30 bg-brand-soft/40 p-3">
          <p className="text-sm font-semibold text-brand">Copy this now. The key won&apos;t be shown again.</p>
          <CopyBox label="Agent key" value={made.token} />
          <Setup m={made} />
        </div>
      )}
    </div>
  );
}
