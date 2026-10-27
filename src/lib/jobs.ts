import { and, asc, eq, lte, or, lt, isNull } from "drizzle-orm";
import { getDb, schema } from "./db";

/**
 * Heavy-work queue. In production the VPS worker (`npm run worker`) claims jobs
 * over the /api/worker endpoints; when no worker is running the scheduler runs
 * them inline so everything still works on a single box.
 */
export type JobType = "meeting.process" | "video.process" | "video.render_clip" | "voice.render" | "song.generate" | "computer.run" | "studio.run";

const HANDLERS: Record<JobType, () => Promise<(payload: Record<string, unknown>) => Promise<Record<string, unknown> | void>>> = {
  "meeting.process": () => import("./modules/meetings").then((m) => m.processMeetingJob),
  "video.process": () => import("./modules/video").then((m) => m.processVideoJob),
  "video.render_clip": () => import("./modules/video").then((m) => m.renderClipJob),
  "voice.render": () => import("./modules/voice").then((m) => m.renderVoiceJob),
  "song.generate": () => import("./modules/music").then((m) => m.generateSongJob),
  "computer.run": () => import("./hub/computer").then((m) => m.runComputerTaskJob),
  "studio.run": () => import("./studio/run").then((m) => m.runGenerationsJob),
};

export async function enqueue(type: JobType, payload: Record<string, unknown>, runAt = new Date()) {
  const db = await getDb();
  const [job] = await db.insert(schema.jobs).values({ type, payload, runAt }).returning();
  return job;
}

/** Claims the next due job (or a job whose lock went stale after 15 minutes). */
export async function claimJob(types?: string[]) {
  const db = await getDb();
  const staleBefore = new Date(Date.now() - 15 * 60_000);
  const candidates = await db
    .select()
    .from(schema.jobs)
    .where(
      and(
        lte(schema.jobs.runAt, new Date()),
        or(eq(schema.jobs.status, "queued"), and(eq(schema.jobs.status, "running"), or(isNull(schema.jobs.lockedAt), lt(schema.jobs.lockedAt, staleBefore)))),
      ),
    )
    .orderBy(asc(schema.jobs.runAt))
    .limit(10);
  for (const c of candidates) {
    if (types && !types.includes(c.type)) continue;
    if (c.status === "running" && c.attempts >= 3) {
      // A job that keeps taking its worker down (crash, OOM, timeout) is never finished; stop retrying it.
      await db
        .update(schema.jobs)
        .set({ status: "failed", lockedAt: null, error: c.error ?? "Stopped after 3 attempts: the worker never finished this job." })
        .where(and(eq(schema.jobs.id, c.id), eq(schema.jobs.status, "running")));
      continue;
    }
    const [claimed] = await db
      .update(schema.jobs)
      .set({ status: "running", lockedAt: new Date(), attempts: c.attempts + 1 })
      // Also match the lock we saw, so two workers can't both reclaim the same stale job.
      .where(and(eq(schema.jobs.id, c.id), eq(schema.jobs.status, c.status), c.lockedAt ? eq(schema.jobs.lockedAt, c.lockedAt) : isNull(schema.jobs.lockedAt)))
      .returning();
    if (claimed) return claimed;
  }
  return null;
}

export async function finishJob(id: string, result: { ok: boolean; result?: Record<string, unknown>; error?: string }) {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
  if (!job) return;
  if (!result.ok && job.attempts < 3) {
    await db.update(schema.jobs).set({ status: "queued", lockedAt: null, error: result.error ?? null, runAt: new Date(Date.now() + job.attempts * 60_000) }).where(eq(schema.jobs.id, id));
    return;
  }
  await db
    .update(schema.jobs)
    .set({ status: result.ok ? "done" : "failed", lockedAt: null, result: result.result ?? null, error: result.error ?? null })
    .where(eq(schema.jobs.id, id));
}

export async function runJob(job: typeof schema.jobs.$inferSelect) {
  const handler = HANDLERS[job.type as JobType];
  if (!handler) return finishJob(job.id, { ok: false, error: `No handler for ${job.type}` });
  try {
    const fn = await handler();
    const result = (await fn(job.payload)) ?? {};
    await finishJob(job.id, { ok: true, result });
  } catch (e) {
    await finishJob(job.id, { ok: false, error: (e as Error).message });
  }
}

/** Runs queued jobs in-process (single-box mode). */
export async function runPendingJobsInline(max = 3, types?: string[]) {
  let n = 0;
  for (; n < max; n++) {
    const job = await claimJob(types);
    if (!job) break;
    await runJob(job);
  }
  return n;
}
