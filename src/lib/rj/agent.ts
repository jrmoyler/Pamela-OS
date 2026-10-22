import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { complete, PROVIDER_LABELS, type ChatMessage, type ProviderId, type ToolCall } from "../ai";
import { getSetting } from "../settings";
import { formatInTz } from "../time";
import { herVoiceSystem } from "./voice";
import { RJ_TOOLS, runTool } from "./tools";

const MAX_ROUNDS = 6;

async function systemPrompt() {
  const tz = await getSetting("timezone");
  const blackouts = await getSetting("blackouts");
  return [
    "You are RJ, Pamela's operator inside Pamela OS. You run her day: triage, research inside her data, drafting in her voice, scheduling and follow-through.",
    `It is ${formatInTz(new Date(), tz, { dateStyle: "full", timeStyle: "short" })} (${tz}).`,
    `Protected time: ${blackouts.map((b) => b.label).join("; ")} — never book or schedule calls in it.`,
    "Hard rules:",
    "- You never send anything yourself. Emails, texts, DMs, posts and payments are drafted with tools and land in Approvals for Pamela's yes. Say so when you draft.",
    "- Use tools to look things up instead of guessing. Cite names and dates you found.",
    "- Be brief and warm. Lead with what matters. Use short bullet lists.",
    await herVoiceSystem(),
  ].join("\n");
}

type StoredMessage = typeof schema.rjMessages.$inferSelect;

function toChat(history: StoredMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const calls = (m.toolCalls ?? []).map((t) => ({ id: t.id, name: t.name, args: t.args }));
      out.push({ role: "assistant", content: m.content, toolCalls: calls });
      for (const t of m.toolCalls ?? []) out.push({ role: "tool", toolCallId: t.id, name: t.name, content: JSON.stringify(t.result ?? null).slice(0, 6000) });
    }
  }
  return out;
}

export async function createThread(title = "New conversation") {
  const db = await getDb();
  const [t] = await db.insert(schema.rjThreads).values({ title }).returning();
  return t;
}

/** One user turn: runs the tool loop through Hermes / Meta Muse / her models, persisting every step. */
export async function runRj(threadId: string, text: string) {
  const db = await getDb();
  await db.insert(schema.rjMessages).values({ threadId, role: "user", content: text });
  const history = await db.select().from(schema.rjMessages).where(eq(schema.rjMessages.threadId, threadId)).orderBy(asc(schema.rjMessages.createdAt));
  if (history.length === 1) {
    await db.update(schema.rjThreads).set({ title: text.slice(0, 60) }).where(eq(schema.rjThreads.id, threadId));
  }
  // Claude requires the conversation to open with a user turn, so never start the window on an assistant row.
  let recent = history.slice(-40);
  const firstUser = recent.findIndex((m) => m.role === "user");
  if (firstUser > 0) recent = recent.slice(firstUser);
  const messages: ChatMessage[] = [{ role: "system", content: await systemPrompt() }, ...toChat(recent)];
  const tools = RJ_TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const executed: { id: string; name: string; args: Record<string, unknown>; result?: unknown }[] = [];
  let provider: ProviderId | "offline" = "offline";
  let final = "";
  // Multi-step requests go to the agentic route (Meta Muse first by default); simple chat to Hermes.
  const task = /\b(and then|plan|research|every|all of|for each|follow[- ]?up with)\b/i.test(text) ? "agentic" : "chat";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const r = await complete({ task, messages, tools, maxTokens: 1500 });
    if (!r) break;
    provider = r.provider;
    if (!r.toolCalls.length) {
      final = r.content;
      break;
    }
    messages.push({ role: "assistant", content: r.content, toolCalls: r.toolCalls, raw: r.raw });
    for (const call of r.toolCalls) {
      const result = await runTool(call.name, call.args);
      executed.push({ ...call, result });
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(result).slice(0, 6000) });
    }
    if (round === MAX_ROUNDS - 1) final = r.content || "I've done what I can for now — check the results above.";
  }
  // A model can go quiet after running tools (provider failed mid-loop, or an empty reply); never store a blank answer.
  if (provider !== "offline" && !final.trim()) {
    final = executed.length ? "I've done what I can for now — check the results above." : "I couldn't come up with a reply just now. Please try again.";
  }

  if (provider === "offline") {
    const off = await offlineRj(text);
    final = off.reply;
    executed.push(...off.calls);
  }

  const [msg] = await db
    .insert(schema.rjMessages)
    .values({ threadId, role: "assistant", content: final, toolCalls: executed, provider: provider === "offline" ? "offline" : PROVIDER_LABELS[provider] })
    .returning();
  await db.update(schema.rjThreads).set({ updatedAt: new Date() }).where(eq(schema.rjThreads.id, threadId));
  return msg;
}

/**
 * When no model is connected RJ still handles the everyday commands directly
 * against her data, so the operator layer is never a dead end.
 */
export async function offlineRj(text: string): Promise<{ reply: string; calls: ToolCall[] & { result?: unknown }[] }> {
  const t = text.trim();
  const calls: (ToolCall & { result?: unknown })[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await runTool(name, args);
    calls.push({ id: `offline-${calls.length}`, name, args, result });
    return result as never;
  };
  const note = "\n\n_Connect Hermes, Meta Muse, Claude, ChatGPT or Gemini in Settings for full conversations._";

  let m = t.match(/^(?:add|create|new)\s+(?:a\s+)?task:?\s+(.+?)(?:\s+(?:due|by)\s+(today|tomorrow|in \d+ days?|\d{4}-\d{2}-\d{2}))?$/i);
  if (m) {
    const r = await call("create_task", { title: m[1], due: m[2] });
    if ((r as { error?: string }).error) return { reply: `Couldn't add the task: ${(r as { error: string }).error}.`, calls };
    return { reply: `Added the task “${(r as { title: string }).title}”${m[2] ? ` due ${m[2]}` : ""}.`, calls };
  }
  m = t.match(/^(?:draft|write)\s+(?:an?\s+)?(email|text)\s+to\s+(.+?)\s+(?:about|saying|re:?)\s+(.+)$/i);
  if (m) {
    const [, kind, who, about] = m;
    const people = (await call("search_contacts", { query: who })) as { id: string; name: string }[];
    if (!people.length) return { reply: `I couldn't find “${who}” in your contacts.`, calls };
    const { draftInHerVoice } = await import("./voice");
    const db = await getDb();
    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, people[0].id));
    const d = await draftInHerVoice({ channel: kind.toLowerCase() === "text" ? "sms" : "email", instructions: about, contact });
    const r = kind.toLowerCase() === "text" ? await call("draft_text", { contactId: contact.id, body: d.body }) : await call("draft_email", { contactId: contact.id, subject: d.subject, body: d.body });
    if ((r as { error?: string }).error) return { reply: `Couldn't draft: ${(r as { error: string }).error}.`, calls };
    return { reply: `Drafted a ${kind.toLowerCase()} to ${people[0].name}. It's in Approvals waiting for your yes.`, calls };
  }
  if (/\b(brief|morning|triage|today|what('s| is) up|catch me up)\b/i.test(t) && !/\b(due|tasks?|to-?do)\b/i.test(t)) {
    const brief = await call("daily_triage", {});
    if (typeof brief !== "string") return { reply: `I couldn't pull your brief: ${(brief as { error?: string }).error ?? "unknown error"}.`, calls };
    return { reply: `Here's where things stand:\n\n${brief}`, calls };
  }
  if (/\b(due|tasks?|to-?do)\b/i.test(t)) {
    const scope = /overdue/i.test(t) ? "overdue" : /today/i.test(t) ? "today" : "week";
    const rows = (await call("list_tasks", { scope })) as { title: string; due: string | null; priority: string }[];
    return { reply: rows.length ? `Open tasks (${scope}):\n${rows.map((r) => `- ${r.title}${r.due ? ` — ${r.due}` : ""}${r.priority === "urgent" ? " (urgent)" : ""}`).join("\n")}` : `Nothing ${scope === "overdue" ? "overdue" : `due ${scope === "today" ? "today" : "this week"}`}. 🎉`, calls };
  }
  if (/\b(approv|waiting|pending)\b/i.test(t)) {
    const rows = (await call("pending_approvals", {})) as { title: string; kind: string }[];
    return { reply: rows.length ? `Waiting for your yes:\n${rows.map((r) => `- ${r.title} (${r.kind})`).join("\n")}` : "Nothing is waiting for approval.", calls };
  }
  if (/\b(calendar|schedule|appointments?|bookings?)\b/i.test(t)) {
    const rows = (await call("get_calendar", { days: 7 })) as { title: string; when: string; with: string | null }[];
    return { reply: rows.length ? `Next 7 days:\n${rows.map((r) => `- ${r.when} — ${r.title}${r.with ? ` with ${r.with}` : ""}`).join("\n")}` : "Nothing booked in the next 7 days.", calls };
  }
  if (/\b(open|free|available)\b.*\b(slots?|times?)\b/i.test(t)) {
    const r = (await call("find_open_slots", { days: 7 })) as { bookingType: string; slots: string[]; error?: string };
    if (r.error || !r.slots) return { reply: `I couldn't look up open times: ${r.error ?? "unknown error"}.`, calls };
    if (!r.slots.length) return { reply: `No open ${r.bookingType} times in the next 7 days.`, calls };
    return { reply: `Open ${r.bookingType} times:\n${r.slots.map((s) => `- ${s}`).join("\n")}`, calls };
  }
  m = t.match(/^(?:find|who is|look up|search)\s+(.+)$/i);
  if (m) {
    const rows = (await call("search_contacts", { query: m[1] })) as { name: string; email: string | null; phone: string | null; relationship: string[] }[];
    return { reply: rows.length ? rows.map((r) => `- **${r.name}** ${[r.email, r.phone].filter(Boolean).join(" · ")}${r.relationship.length ? ` (${r.relationship.join(", ")})` : ""}`).join("\n") : `No one matching “${m[1]}”.`, calls };
  }
  return {
    reply:
      "I can help with: **brief me**, **what's due this week**, **what's waiting for approval**, **my calendar**, **open slots**, **add task <title> due tomorrow**, **find <name>**, **draft an email to <name> about <topic>**." +
      note,
    calls,
  };
}
