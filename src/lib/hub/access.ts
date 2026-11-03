import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "../db";
import { emit } from "../events";
import { getSetting, setSetting } from "../settings";
import { CLIENT_LABELS, type AgentClient, type AgentKey } from "./keys";

/**
 * Who may use Pamela's computer, and how she says yes.
 *
 * Two layers, both answered inside Pamela OS:
 *  1. Starting a task. Each connector (an agent key, or RJ) has a policy:
 *     ask (her yes per task), allow (starts right away) or block (refused),
 *     plus the kinds of work it may ask for and an optional "trust for a while".
 *  2. Checkpoints during a task. Before a sensitive step (signing in,
 *     submitting a form, installing, deleting) Hermes calls request_permission
 *     and waits; she approves or denies the single step, with an optional note.
 *
 * Sending, posting, paying, signing and messaging people stay off the table for
 * Hermes no matter what is approved here: those go through Approvals.
 */

export type ComputerPolicy = "ask" | "allow" | "block";
export const COMPUTER_POLICIES: ComputerPolicy[] = ["ask", "allow", "block"];
export const COMPUTER_KINDS = ["browser", "computer", "files"] as const;

export const POLICY_LABELS: Record<ComputerPolicy, string> = {
  ask: "Ask me each time",
  allow: "Always allow",
  block: "Never",
};

export type Access = { policy: ComputerPolicy; kinds: string[]; trustUntil: Date | null };
export type Gate = { decision: "queue" | "ask" | "block"; via?: "allowed" | "trusted"; reason?: string };

/** Pure: what happens to a new task from a requester with this access. */
export function computerGate(access: Access, kind: string, now = new Date()): Gate {
  if (access.policy === "block") return { decision: "block", reason: "Pamela has switched off computer use for this agent." };
  if (!access.kinds.includes(kind)) return { decision: "block", reason: `This agent isn't allowed ${kind} tasks. Pamela can change that in Command Center → Computer access.` };
  if (access.policy === "allow") return { decision: "queue", via: "allowed" };
  if (access.trustUntil && access.trustUntil.getTime() > now.getTime()) return { decision: "queue", via: "trusted" };
  return { decision: "ask" };
}

export const keyAccess = (key: AgentKey): Access => ({
  policy: (COMPUTER_POLICIES as string[]).includes(key.computerPolicy) ? (key.computerPolicy as ComputerPolicy) : "ask",
  kinds: key.computerKinds,
  trustUntil: key.computerTrustUntil,
});

export async function rjAccess(): Promise<Access> {
  const { rj } = await getSetting("computerAccess");
  return { policy: rj.policy, kinds: rj.kinds, trustUntil: rj.trustUntil ? new Date(rj.trustUntil) : null };
}

/** Access for whoever is asking: an agent key, RJ, or Pamela herself (always allowed). */
export async function accessFor(createdBy: string, agentKeyId?: string | null): Promise<Access | null> {
  if (createdBy === "user") return null;
  if (agentKeyId) {
    const db = await getDb();
    const [key] = await db.select().from(schema.agentKeys).where(eq(schema.agentKeys.id, agentKeyId));
    if (!key || key.revokedAt) return { policy: "block", kinds: [], trustUntil: null };
    return keyAccess(key);
  }
  return rjAccess();
}

/** "rj" or an agent key id: the two kinds of connector that can ask for computer work. */
export type Requester = { kind: "rj" } | { kind: "key"; id: string };

export async function setAccess(who: Requester, patch: { policy?: ComputerPolicy; kinds?: string[]; trustUntil?: Date | null }) {
  const kinds = patch.kinds?.filter((k) => (COMPUTER_KINDS as readonly string[]).includes(k));
  if (who.kind === "rj") {
    const cur = await getSetting("computerAccess");
    await setSetting("computerAccess", {
      ...cur,
      rj: {
        policy: patch.policy ?? cur.rj.policy,
        kinds: kinds ?? cur.rj.kinds,
        trustUntil: patch.trustUntil === undefined ? cur.rj.trustUntil : patch.trustUntil ? patch.trustUntil.toISOString() : null,
      },
    });
  } else {
    const db = await getDb();
    await db
      .update(schema.agentKeys)
      .set({
        ...(patch.policy ? { computerPolicy: patch.policy } : {}),
        ...(kinds ? { computerKinds: kinds } : {}),
        ...(patch.trustUntil !== undefined ? { computerTrustUntil: patch.trustUntil } : {}),
      })
      .where(eq(schema.agentKeys.id, who.id));
  }
  await emit("computer.access_changed", { who: who.kind === "rj" ? "rj" : who.id, ...patch, kinds }, "user");
}

export const TRUST_WINDOWS = { "1h": 60, "4h": 240, today: 0 } as const;
export type TrustWindow = keyof typeof TRUST_WINDOWS;

/** End of the trust window: minutes from now, or "today" = until midnight in her timezone. */
export function trustUntil(window: TrustWindow, now = new Date(), timeZone = "America/Los_Angeles"): Date {
  if (window !== "today") return new Date(now.getTime() + TRUST_WINDOWS[window] * 60_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const elapsed = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return new Date(now.getTime() - elapsed + 24 * 3600_000);
}

export function requesterOf(task: { createdBy: string; agentKeyId: string | null }): Requester | null {
  if (task.agentKeyId) return { kind: "key", id: task.agentKeyId };
  if (task.createdBy === "rj") return { kind: "rj" };
  return null;
}

/* ───────────────────────── Checkpoints during a task ───────────────────────── */

export type Permission = typeof schema.computerPermissions.$inferSelect;

export const PERMISSION_CATEGORIES = {
  sign_in: "Sign in to a site or app",
  submit_form: "Submit a form",
  download: "Download files",
  upload: "Upload a file",
  install: "Install or update software",
  delete: "Delete or move files",
  open_app: "Open another site or app",
  settings: "Change a setting",
  other: "Something else",
} as const;
export type PermissionCategory = keyof typeof PERMISSION_CATEGORIES;

/** How long a checkpoint waits for her before it lapses (Hermes is told to skip the step). */
export const PERMISSION_TTL_MIN = 30;

/**
 * Heuristic shown as a warning on the checkpoint card: does this step look like
 * it reaches another person or moves money? Hermes's rules already forbid that.
 */
const OUTBOUND = /\b(send (it |this |an? )?(e-?mail|text|message|dm)|reply to|post (it|this|to)|publish|pay (the|this|now)|place (the|an?) order|buy|purchase|check ?out|e-?sign|sign the (contract|agreement|document)|wire|transfer (money|funds))\b/i;

export function looksOutbound(text: string) {
  return OUTBOUND.test(text);
}

export async function requestPermission(input: {
  taskId: string;
  action: string;
  detail?: string | null;
  url?: string | null;
  category?: string;
  requestedBy: string;
  agentKeyId?: string | null;
}) {
  const action = input.action.trim().slice(0, 500);
  if (!action) throw new Error("Say what you want to do.");
  const db = await getDb();
  const [task] = await db.select().from(schema.computerTasks).where(eq(schema.computerTasks.id, input.taskId));
  if (!task) throw new Error("No such computer task.");
  if (!["running", "queued"].includes(task.status)) throw new Error(`That task is ${task.status}; stop working on it.`);
  const category = input.category && input.category in PERMISSION_CATEGORIES ? input.category : "other";
  const [permission] = await db
    .insert(schema.computerPermissions)
    .values({
      taskId: task.id,
      agentKeyId: input.agentKeyId ?? null,
      requestedBy: input.requestedBy,
      category,
      action,
      detail: input.detail?.slice(0, 4000) || null,
      url: input.url?.slice(0, 2000) || null,
      expiresAt: new Date(Date.now() + PERMISSION_TTL_MIN * 60_000),
    })
    .returning();
  await emit("computer.permission_requested", { permissionId: permission.id, taskId: task.id, category, action }, input.requestedBy);
  return permission;
}

/** Lapses checkpoints nobody answered in time, so Hermes isn't left waiting forever. */
export async function expirePermissions(now = new Date()) {
  const db = await getDb();
  await db
    .update(schema.computerPermissions)
    .set({ status: "expired", decidedAt: now })
    .where(and(eq(schema.computerPermissions.status, "pending"), lt(schema.computerPermissions.expiresAt, now)));
}

export async function getPermission(id: string) {
  await expirePermissions();
  const db = await getDb();
  const [p] = await db.select().from(schema.computerPermissions).where(eq(schema.computerPermissions.id, id));
  return p ?? null;
}

export async function decidePermission(id: string, approve: boolean, note?: string | null) {
  const db = await getDb();
  const [p] = await db
    .update(schema.computerPermissions)
    .set({ status: approve ? "approved" : "denied", note: note?.trim().slice(0, 1000) || null, decidedAt: new Date() })
    .where(and(eq(schema.computerPermissions.id, id), eq(schema.computerPermissions.status, "pending")))
    .returning();
  if (p) await emit(approve ? "computer.permission_approved" : "computer.permission_denied", { permissionId: id, taskId: p.taskId, note: p.note }, "user");
  return p ?? null;
}

/** Cancelling a task answers its open checkpoints with a no. */
export async function denyOpenPermissions(taskId: string, note = "The task was cancelled.") {
  const db = await getDb();
  await db
    .update(schema.computerPermissions)
    .set({ status: "denied", note, decidedAt: new Date() })
    .where(and(eq(schema.computerPermissions.taskId, taskId), eq(schema.computerPermissions.status, "pending")));
}

/** What the agent is told when it checks a checkpoint. */
export function permissionReply(p: Permission) {
  const base = { permissionId: p.id, taskId: p.taskId, status: p.status, note: p.note };
  switch (p.status) {
    case "approved":
      return { ...base, instruction: "Approved. Do only this step, then carry on with the task." + (p.note ? ` Pamela added: ${p.note}` : "") };
    case "denied":
      return { ...base, instruction: "Denied. Skip this step, don't try another way around it, and say so in your summary." + (p.note ? ` Pamela added: ${p.note}` : "") };
    case "expired":
      return { ...base, instruction: "Pamela didn't answer in time. Skip this step and mention it in your summary." };
    default:
      return { ...base, instruction: "Still waiting for Pamela. Check again in about 20 seconds; don't do the step yet." };
  }
}

/** Everything waiting for her yes on the computer side: tasks to start and checkpoints mid-task. */
export async function pendingComputerApprovals() {
  await expirePermissions();
  const db = await getDb();
  const [tasks, permissions, keys] = await Promise.all([
    db.select().from(schema.computerTasks).where(eq(schema.computerTasks.status, "awaiting_approval")).orderBy(desc(schema.computerTasks.createdAt)).limit(50),
    db
      .select({ p: schema.computerPermissions, t: schema.computerTasks })
      .from(schema.computerPermissions)
      .leftJoin(schema.computerTasks, eq(schema.computerPermissions.taskId, schema.computerTasks.id))
      .where(eq(schema.computerPermissions.status, "pending"))
      .orderBy(desc(schema.computerPermissions.createdAt))
      .limit(50),
    db.select().from(schema.agentKeys),
  ]);
  const keyName = new Map(
    keys.map((k) => {
      const label = CLIENT_LABELS[k.client as AgentClient] ?? k.client;
      return [k.id, k.name === label ? k.name : `${k.name} (${label})`];
    }),
  );
  const who = (createdBy: string, agentKeyId: string | null) => (agentKeyId && keyName.get(agentKeyId)) || (createdBy === "rj" ? "RJ" : createdBy);
  return {
    tasks: tasks.map((t) => ({ ...t, who: who(t.createdBy, t.agentKeyId) })),
    permissions: permissions.map(({ p, t }) => ({ ...p, task: t, who: who(p.requestedBy, p.agentKeyId) })),
  };
}

export async function pendingComputerCount() {
  const db = await getDb();
  const [tasks, perms] = await Promise.all([
    db.select({ id: schema.computerTasks.id }).from(schema.computerTasks).where(eq(schema.computerTasks.status, "awaiting_approval")),
    db
      .select({ id: schema.computerPermissions.id, expiresAt: schema.computerPermissions.expiresAt })
      .from(schema.computerPermissions)
      .where(inArray(schema.computerPermissions.status, ["pending"])),
  ]);
  const now = Date.now();
  return tasks.length + perms.filter((p) => !p.expiresAt || p.expiresAt.getTime() > now).length;
}
