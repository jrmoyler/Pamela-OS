import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { emit } from "../events";
import { getSecret, getSetting } from "../settings";
import { enqueue } from "../jobs";
import { BRAND } from "../brand";

/**
 * The bridge to Hermes Agent, which runs with access to Pamela's computer and
 * browser. Tasks reach Hermes one of two ways:
 *
 *  - push: Pamela OS calls the Hermes OpenAI-compatible API with the task and
 *    stores its answer (needs the Hermes API reachable from the server).
 *  - pull: Hermes, connected to Pamela OS over MCP, claims queued tasks with
 *    `next_computer_task` and reports back with `finish_computer_task`
 *    (works when Hermes runs on her laptop with no inbound access).
 *
 * Tasks asked for by an agent (RJ, Claude, ChatGPT, Meta Muse) wait for her yes
 * first; tasks she types herself go straight to the queue.
 */

export type ComputerTask = typeof schema.computerTasks.$inferSelect;
export type ComputerKind = "browser" | "computer" | "files";

export const KIND_LABELS: Record<ComputerKind, string> = {
  browser: "Browser",
  computer: "Computer",
  files: "Files",
};

/** Ground rules sent with every task, whichever way it reaches Hermes. */
export const COMPUTER_RULES = [
  `You are working on Pamela's own computer and browser for ${BRAND.name}, on a task she (or her operator) queued in Pamela OS.`,
  "Never send, post, publish, pay, sign, buy or delete anything, and never message another person. If the task needs that, stop and say so: Pamela approves outbound actions inside Pamela OS.",
  "Never type or reveal passwords, government ID numbers or card numbers.",
  "When you produce or download files Pamela should keep, send them to Pamela OS with the push_file tool and include this task's id as computerTaskId.",
  "Finish with a short plain summary of what you did and what you found.",
].join("\n");

async function computerMode(): Promise<"push" | "pull"> {
  const mode = await getSetting("computerMode");
  if (mode === "push" || mode === "pull") return mode;
  return (await getSecret("HERMES_BASE_URL")) ? "push" : "pull";
}

export async function createComputerTask(instruction: string, kind: ComputerKind = "browser", createdBy = "user") {
  const text = instruction.trim();
  if (!text) throw new Error("Tell Hermes what to do.");
  const db = await getDb();
  const [task] = await db
    .insert(schema.computerTasks)
    .values({ instruction: text.slice(0, 4000), kind, createdBy, status: createdBy === "user" ? "queued" : "awaiting_approval" })
    .returning();
  await emit("computer.task_created", { taskId: task.id, kind, createdBy, status: task.status }, createdBy);
  if (task.status === "queued") await dispatch(task);
  return task;
}

async function dispatch(task: ComputerTask) {
  if ((await computerMode()) === "push") await enqueue("computer.run", { taskId: task.id });
}

export async function approveComputerTask(id: string) {
  const db = await getDb();
  const [task] = await db
    .update(schema.computerTasks)
    .set({ status: "queued" })
    .where(and(eq(schema.computerTasks.id, id), eq(schema.computerTasks.status, "awaiting_approval")))
    .returning();
  if (task) await dispatch(task);
  return task ?? null;
}

export async function cancelComputerTask(id: string) {
  const db = await getDb();
  await db
    .update(schema.computerTasks)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(schema.computerTasks.id, id), inArray(schema.computerTasks.status, ["awaiting_approval", "queued", "running"])));
}

/** Puts a finished or failed task back in the queue. */
export async function retryComputerTask(id: string) {
  const db = await getDb();
  const [task] = await db
    .update(schema.computerTasks)
    .set({ status: "queued", error: null, result: null, claimedAt: null, claimedBy: null, finishedAt: null })
    .where(and(eq(schema.computerTasks.id, id), inArray(schema.computerTasks.status, ["failed", "cancelled", "done"])))
    .returning();
  if (task) await dispatch(task);
  return task ?? null;
}

/** Pull mode: Hermes claims the oldest queued task (or one stuck "running" for over 30 minutes). */
export async function claimNextComputerTask(): Promise<ComputerTask | null> {
  const db = await getDb();
  const candidates = await db
    .select()
    .from(schema.computerTasks)
    .where(inArray(schema.computerTasks.status, ["queued", "running"]))
    .orderBy(asc(schema.computerTasks.createdAt))
    .limit(10);
  const staleBefore = Date.now() - 30 * 60_000;
  for (const c of candidates) {
    if (c.status === "running" && (c.claimedBy !== "pull" || (c.claimedAt && c.claimedAt.getTime() > staleBefore))) continue;
    const [claimed] = await db
      .update(schema.computerTasks)
      .set({ status: "running", claimedBy: "pull", claimedAt: new Date() })
      .where(and(eq(schema.computerTasks.id, c.id), eq(schema.computerTasks.status, c.status)))
      .returning();
    if (claimed) return claimed;
  }
  return null;
}

export async function finishComputerTask(id: string, outcome: { ok: boolean; result?: string; error?: string; fileIds?: string[] }) {
  const db = await getDb();
  const [cur] = await db.select().from(schema.computerTasks).where(eq(schema.computerTasks.id, id));
  if (!cur) throw new Error("No such computer task.");
  if (cur.status === "cancelled") return cur;
  const fileIds = [...new Set([...cur.fileIds, ...(outcome.fileIds ?? [])])];
  const [task] = await db
    .update(schema.computerTasks)
    .set({
      status: outcome.ok ? "done" : "failed",
      result: outcome.result?.slice(0, 20_000) ?? cur.result,
      error: outcome.ok ? null : (outcome.error ?? "Hermes reported a failure."),
      fileIds,
      finishedAt: new Date(),
    })
    .where(eq(schema.computerTasks.id, id))
    .returning();
  await emit(outcome.ok ? "computer.task_done" : "computer.task_failed", { taskId: id, fileIds, error: task.error }, "hermes");
  return task;
}

/** Files pushed with a computerTaskId are attached to that task as they arrive. */
export async function attachFileToTask(taskId: string, fileId: string) {
  const db = await getDb();
  const [cur] = await db.select().from(schema.computerTasks).where(eq(schema.computerTasks.id, taskId));
  if (!cur) return;
  await db
    .update(schema.computerTasks)
    .set({ fileIds: [...new Set([...cur.fileIds, fileId])] })
    .where(eq(schema.computerTasks.id, taskId));
}

/** Push mode job: hands the task to the Hermes API and waits for its answer. */
export async function runComputerTaskJob(payload: Record<string, unknown>) {
  const id = String(payload.taskId);
  const db = await getDb();
  const [task] = await db.select().from(schema.computerTasks).where(eq(schema.computerTasks.id, id));
  if (!task || task.status !== "queued") return { skipped: task?.status ?? "missing" };
  const baseUrl = await getSecret("HERMES_BASE_URL");
  if (!baseUrl) {
    await finishComputerTask(id, { ok: false, error: "Hermes isn't connected. Add it in Settings → Connections, or switch the Command Center to pull mode." });
    return { error: "no hermes" };
  }
  await db.update(schema.computerTasks).set({ status: "running", claimedBy: "push", claimedAt: new Date() }).where(eq(schema.computerTasks.id, id));
  const apiKey = await getSecret("HERMES_API_KEY");
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: (await getSecret("HERMES_MODEL")) || "hermes-agent",
        messages: [
          { role: "system", content: COMPUTER_RULES },
          { role: "user", content: `Task ${task.id} (${KIND_LABELS[task.kind as ComputerKind] ?? task.kind}):\n${task.instruction}` },
        ],
      }),
      // Hermes may browse for a while; stay under the job queue's 15-minute stale-lock window.
      signal: AbortSignal.timeout(14 * 60_000),
    });
    if (!res.ok) throw new Error(`Hermes answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message?.content;
    const text = Array.isArray(msg) ? msg.map((p: { text?: string }) => p.text ?? "").join("") : String(msg ?? "");
    await finishComputerTask(id, { ok: true, result: text.trim() || "Hermes finished without a summary." });
    return { ok: true };
  } catch (e) {
    await finishComputerTask(id, { ok: false, error: (e as Error).message });
    return { error: (e as Error).message };
  }
}
