"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { complete, PROVIDER_LABELS, type ProviderId } from "@/lib/ai";
import { herVoiceSystem } from "@/lib/rj/voice";
import { runTool } from "@/lib/rj/tools";
import { setSetting } from "@/lib/settings";
import { appUrl } from "@/lib/outbound";
import { AGENT_CLIENTS, createAgentKey, revokeAgentKey, type AgentClient, type Scope } from "@/lib/hub/keys";
import { addInboxItem, setInboxStatus, SOURCE_LABELS } from "@/lib/hub/inbox";
import { logActivity } from "@/lib/crm";
import { approveComputerTask, cancelComputerTask, createComputerTask, retryComputerTask, type ComputerKind } from "@/lib/hub/computer";

const PROVIDERS: ProviderId[] = ["hermes", "meta", "anthropic", "openai", "gemini"];

/** Sends one prompt to exactly the model she picked (no fallthrough), so she can drive each one from here. */
export async function askModel(provider: string, prompt: string): Promise<{ text: string; provider: string } | { error: string }> {
  await requireSession();
  if (!PROVIDERS.includes(provider as ProviderId)) return { error: "Pick a model." };
  if (!prompt.trim()) return { error: "Type a question first." };
  try {
    const r = await complete({
      task: "chat",
      only: provider as ProviderId,
      maxTokens: 2000,
      messages: [
        { role: "system", content: `You are helping Pamela from her Pamela OS Command Center.\n${await herVoiceSystem()}` },
        { role: "user", content: prompt },
      ],
    });
    if (!r) return { error: `${PROVIDER_LABELS[provider as ProviderId]} isn't connected. Add its key in Settings → Connections.` };
    return { text: r.content.trim(), provider: PROVIDER_LABELS[r.provider] };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveAnswerToInbox(provider: string, prompt: string, answer: string) {
  await requireSession();
  const source = ({ hermes: "hermes", meta: "meta", anthropic: "claude", openai: "chatgpt", gemini: "other" } as Record<string, string>)[provider] ?? "other";
  await addInboxItem({ kind: "note", source, title: prompt.slice(0, 120), body: answer });
  revalidatePath("/hub");
}

export async function createKey(name: string, client: string, scopes: string[]) {
  await requireSession();
  const c = (AGENT_CLIENTS as readonly string[]).includes(client) ? (client as AgentClient) : "other";
  const s = scopes.filter((x): x is Scope => ["read", "write", "computer"].includes(x));
  if (!s.length) return { error: "Pick at least one permission." };
  const { key, token } = await createAgentKey(name, c, s);
  revalidatePath("/hub/connect");
  const base = appUrl();
  return { id: key.id, token, mcpUrl: `${base}/api/mcp`, mcpUrlWithKey: `${base}/api/mcp/k/${token}`, inboxUrl: `${base}/api/inbox` };
}

export async function revokeKey(id: string) {
  await requireSession();
  await revokeAgentKey(id);
  revalidatePath("/hub/connect");
}

export async function queueComputerTask(form: FormData) {
  await requireSession();
  const kind = (["browser", "computer", "files"].includes(String(form.get("kind"))) ? String(form.get("kind")) : "browser") as ComputerKind;
  await createComputerTask(String(form.get("instruction") ?? ""), kind, "user");
  revalidatePath("/hub");
}

export async function approveTask(id: string) {
  await requireSession();
  await approveComputerTask(id);
  revalidatePath("/hub");
}

export async function cancelTask(id: string) {
  await requireSession();
  await cancelComputerTask(id);
  revalidatePath("/hub");
}

export async function retryTask(id: string) {
  await requireSession();
  await retryComputerTask(id);
  revalidatePath("/hub");
}

export async function setComputerMode(mode: "auto" | "push" | "pull") {
  await requireSession();
  await setSetting("computerMode", mode);
  revalidatePath("/hub");
}

export async function markInbox(id: string, status: "new" | "filed" | "dismissed") {
  await requireSession();
  await setInboxStatus(id, status);
  revalidatePath("/hub");
}

/** Turns an inbox item into a task (and files it). */
export async function inboxToTask(id: string) {
  await requireSession();
  const db = await getDb();
  const [item] = await db.select().from(schema.inboxItems).where(eq(schema.inboxItems.id, id));
  if (!item) return;
  await runTool("create_task", { title: item.title, contactId: item.contactId ?? undefined, due: "tomorrow" });
  await setInboxStatus(id, "filed");
  revalidatePath("/hub");
}

/** Files an inbox item onto a person's timeline. */
export async function inboxToContact(id: string, form: FormData) {
  await requireSession();
  const db = await getDb();
  const [item] = await db.select().from(schema.inboxItems).where(eq(schema.inboxItems.id, id));
  const name = String(form.get("contact") ?? "").trim();
  if (!item || !name) return;
  const found = (await runTool("search_contacts", { query: name })) as { id: string }[] | { error: string };
  if (!Array.isArray(found) || !found.length) return;
  const contactId = found[0].id;
  const body = [item.body, item.url, item.fileId ? `File: ${appUrl()}/api/files/${item.fileId}` : null].filter(Boolean).join("\n\n");
  await logActivity({ type: "note", contactId, title: `${SOURCE_LABELS[item.source] ?? item.source}: ${item.title}`, body: body || null, subjectType: "inbox_item", subjectId: item.id });
  await db.update(schema.inboxItems).set({ contactId, status: "filed" }).where(eq(schema.inboxItems.id, id));
  revalidatePath("/hub");
}
