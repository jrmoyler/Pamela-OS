import { processDueEnrollments } from "./sequences";
import { runDueApprovals } from "./approvals";
import { redispatchStale } from "./events";
import { runPendingJobsInline } from "./jobs";
import { ensureTodaysBriefing } from "./rj/briefing";
import { syncSources } from "./hub/sources";

type G = { __pamelaTick?: Promise<unknown> | null; __pamelaLastTick?: number };
const g = globalThis as unknown as G;

/**
 * One scheduler pass. Triggered by /api/cron/tick (Vercel cron, VPS crontab, or
 * the open app's heartbeat). Re-entrancy safe within a process.
 */
export async function tick() {
  if (g.__pamelaTick) return { skipped: true };
  g.__pamelaTick = (async () => {
    const out: Record<string, unknown> = {};
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        out[name] = await fn();
      } catch (e) {
        out[name] = { error: (e as Error).message };
        console.error(`[scheduler] ${name} failed`, e);
      }
    };
    await step("sequences", () => processDueEnrollments());
    await step("approvals", () => runDueApprovals());
    await step("events", () => redispatchStale());
    if (process.env.INLINE_JOBS !== "0") await step("jobs", () => runPendingJobsInline(2));
    await step("briefing", () => ensureTodaysBriefing());
    await step("sources", () => syncSources());
    g.__pamelaLastTick = Date.now();
    return out;
  })();
  try {
    return await g.__pamelaTick;
  } finally {
    g.__pamelaTick = null;
  }
}
