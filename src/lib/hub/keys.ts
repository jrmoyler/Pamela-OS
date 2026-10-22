import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../db";

export type AgentKey = typeof schema.agentKeys.$inferSelect;
export type Scope = "read" | "write" | "computer";
export const AGENT_CLIENTS = ["claude", "chatgpt", "meta", "hermes", "other"] as const;
export type AgentClient = (typeof AGENT_CLIENTS)[number];

export const CLIENT_LABELS: Record<AgentClient, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  meta: "Meta Muse",
  hermes: "Hermes Agent",
  other: "Other app",
};

export const SCOPE_LABELS: Record<Scope, string> = {
  read: "Read her data and files",
  write: "Push files and notes, add tasks, draft messages (drafts still need her approval)",
  computer: "Ask Hermes to work on her computer (and, for Hermes, pick those tasks up)",
};

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Creates a key and returns the plain token once; only its hash is stored. */
export async function createAgentKey(name: string, client: AgentClient, scopes: Scope[]) {
  const token = `pos_${crypto.randomBytes(24).toString("base64url")}`;
  const db = await getDb();
  const [key] = await db
    .insert(schema.agentKeys)
    .values({ name: name.trim() || CLIENT_LABELS[client], client, scopes, tokenHash: hash(token), tokenPrefix: token.slice(0, 10) })
    .returning();
  return { key, token };
}

export async function revokeAgentKey(id: string) {
  const db = await getDb();
  await db.update(schema.agentKeys).set({ revokedAt: new Date() }).where(eq(schema.agentKeys.id, id));
}

/** Resolves a bearer token to a live key and records that it was used. */
export async function verifyAgentKey(token: string | null | undefined): Promise<AgentKey | null> {
  if (!token || !token.startsWith("pos_")) return null;
  const db = await getDb();
  const [key] = await db
    .select()
    .from(schema.agentKeys)
    .where(and(eq(schema.agentKeys.tokenHash, hash(token)), isNull(schema.agentKeys.revokedAt)));
  if (!key) return null;
  await db.update(schema.agentKeys).set({ lastUsedAt: new Date() }).where(eq(schema.agentKeys.id, key.id));
  return key;
}

export const hasScope = (key: AgentKey, scope: Scope) => key.scopes.includes(scope);

export function bearer(req: Request) {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || null;
}
