import { getSecret, getSetting } from "../settings";

export type Role = "system" | "user" | "assistant" | "tool";
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; raw?: unknown[] }
  | { role: "tool"; content: string; toolCallId: string; name: string };
export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type Task = "chat" | "drafting" | "agentic" | "summarize";
export type ProviderId = "hermes" | "meta" | "anthropic" | "openai" | "gemini";

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  hermes: "Hermes Agent (RJ)",
  meta: "Meta Muse",
  anthropic: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
};

/** `raw` carries Claude's content blocks (incl. thinking) so a tool loop can replay them unchanged. */
export type CompletionResult = { provider: ProviderId; model: string; content: string; toolCalls: ToolCall[]; raw?: unknown[] };

type ProviderConfig = { id: ProviderId; kind: "openai" | "anthropic"; baseUrl: string; apiKey?: string; model: string };

export async function providerConfig(id: ProviderId): Promise<ProviderConfig | null> {
  switch (id) {
    case "hermes": {
      const baseUrl = await getSecret("HERMES_BASE_URL");
      if (!baseUrl) return null;
      return { id, kind: "openai", baseUrl, apiKey: await getSecret("HERMES_API_KEY"), model: (await getSecret("HERMES_MODEL")) || "hermes-agent" };
    }
    case "meta": {
      const apiKey = await getSecret("META_API_KEY");
      if (!apiKey) return null;
      return {
        id,
        kind: "openai",
        baseUrl: (await getSecret("META_API_BASE_URL")) || "https://api.llama.com/compat/v1",
        apiKey,
        model: (await getSecret("META_MODEL")) || "muse-spark",
      };
    }
    case "anthropic": {
      const apiKey = await getSecret("ANTHROPIC_API_KEY");
      if (!apiKey) return null;
      return { id, kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey, model: (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-5-5" };
    }
    case "openai": {
      const apiKey = await getSecret("OPENAI_API_KEY");
      if (!apiKey) return null;
      return { id, kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey, model: (await getSecret("OPENAI_MODEL")) || "gpt-5-mini" };
    }
    case "gemini": {
      const apiKey = await getSecret("GEMINI_API_KEY");
      if (!apiKey) return null;
      return {
        id,
        kind: "openai",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey,
        model: (await getSecret("GEMINI_MODEL")) || "gemini-2.5-flash",
      };
    }
  }
}

export async function configuredProviders(): Promise<ProviderId[]> {
  const ids: ProviderId[] = ["hermes", "meta", "anthropic", "openai", "gemini"];
  const out: ProviderId[] = [];
  for (const id of ids) if (await providerConfig(id)) out.push(id);
  return out;
}

async function callOpenAI(cfg: ProviderConfig, messages: ChatMessage[], tools: ToolDef[] | undefined, maxTokens: number, json: boolean): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    // OpenAI's current models (gpt-5*, o-series) reject max_tokens; compatible hosts still expect it.
    ...(cfg.id === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    messages: messages.map((m) => {
      if (m.role === "assistant")
        return {
          role: "assistant",
          // content may only be null when tool_calls are present.
          content: m.content || (m.toolCalls?.length ? null : ""),
          ...(m.toolCalls?.length
            ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } })) }
            : {}),
        };
      if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      return { role: m.role, content: m.content };
    }),
  };
  if (tools?.length) body.tools = tools.map((t) => ({ type: "function", function: t }));
  if (json && !tools?.length) body.response_format = { type: "json_object" };
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${cfg.id} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  // Some OpenAI-compatible hosts (incl. Meta's) return content as an array of parts.
  const content = Array.isArray(msg.content) ? msg.content.map((p: { text?: string }) => p.text ?? "").join("") : (msg.content ?? "");
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((t: { id?: string; function: { name: string; arguments: string | Record<string, unknown> } }, i: number) => ({
    // Some compatible hosts omit ids or send arguments as an object instead of a JSON string.
    id: t.id || `call_${Date.now().toString(36)}_${i}`,
    name: t.function.name,
    args: (typeof t.function.arguments === "string" ? safeJson(t.function.arguments) : t.function.arguments) ?? {},
  }));
  return { provider: cfg.id, model: cfg.model, content, toolCalls };
}

async function callAnthropic(cfg: ProviderConfig, messages: ChatMessage[], tools: ToolDef[] | undefined, maxTokens: number): Promise<CompletionResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const out: { role: "user" | "assistant"; content: unknown[] }[] = [];
  const push = (role: "user" | "assistant", block: unknown) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") push("user", { type: "text", text: m.content });
    else if (m.role === "assistant") {
      // Claude thinks by default; within a tool loop its thinking blocks must come back unchanged.
      if (m.raw?.length) {
        for (const b of m.raw) push("assistant", b);
        continue;
      }
      if (m.content) push("assistant", { type: "text", text: m.content });
      for (const t of m.toolCalls ?? []) push("assistant", { type: "tool_use", id: t.id, name: t.name, input: t.args });
    } else if (m.role === "tool") push("user", { type: "tool_result", tool_use_id: m.toolCallId, content: m.content });
  }
  const res = await fetch(`${cfg.baseUrl}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": cfg.apiKey!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: cfg.model,
      // Thinking shares this budget, so small caps would truncate replies mid-thought.
      max_tokens: Math.max(maxTokens, 16000),
      system: system || undefined,
      messages: out,
      tools: tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  let content = "";
  const toolCalls: ToolCall[] = [];
  for (const b of data.content ?? []) {
    if (b.type === "text") content += b.text;
    if (b.type === "tool_use") toolCalls.push({ id: b.id, name: b.name, args: b.input ?? {} });
  }
  return { provider: "anthropic", model: cfg.model, content, toolCalls, raw: data.content };
}

export type CompleteOptions = {
  task: Task;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
  json?: boolean;
  prefer?: ProviderId;
  /** Use exactly this provider, with no fallthrough (the Command Center's "ask a model"). */
  only?: ProviderId;
};

/**
 * Routes a completion through Pamela's configured models in the order set in
 * Settings → AI routing. Returns null when no model is connected so callers can
 * fall back to deterministic behaviour.
 */
export async function complete(opts: CompleteOptions): Promise<CompletionResult | null> {
  const routing = await getSetting("aiRouting");
  const order = opts.only ? [opts.only] : [...new Set([...(opts.prefer ? [opts.prefer] : []), ...(routing[opts.task] as ProviderId[])])];
  const errors: string[] = [];
  for (const id of order) {
    const cfg = await providerConfig(id);
    if (!cfg) continue;
    try {
      return cfg.kind === "anthropic"
        ? await callAnthropic(cfg, opts.messages, opts.tools, opts.maxTokens ?? 1500)
        : await callOpenAI(cfg, opts.messages, opts.tools, opts.maxTokens ?? 1500, !!opts.json);
    } catch (e) {
      errors.push(String((e as Error).message));
    }
  }
  if (errors.length) console.warn("[ai] all providers failed:", errors.join(" | "));
  if (opts.only && errors.length) throw new Error(errors[0]);
  return null;
}

export async function aiText(task: Task, system: string, prompt: string, maxTokens = 1200): Promise<{ text: string; provider: ProviderId } | null> {
  const r = await complete({ task, maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] });
  return r ? { text: r.content.trim(), provider: r.provider } : null;
}

export async function aiJson<T>(task: Task, system: string, prompt: string, maxTokens = 2000): Promise<{ data: T; provider: ProviderId } | null> {
  const r = await complete({
    task,
    maxTokens,
    json: true,
    messages: [
      { role: "system", content: `${system}\n\nRespond with a single JSON object only. No prose, no code fences.` },
      { role: "user", content: prompt },
    ],
  });
  if (!r) return null;
  const data = safeJson<T>(r.content);
  return data ? { data, provider: r.provider } : null;
}

export function safeJson<T = Record<string, unknown>>(s: string | undefined | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  }
}
