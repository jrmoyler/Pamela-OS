/**
 * Pamela OS VPS worker.
 *
 * Runs next to Hermes Agent on the VPS: claims heavy jobs (video processing,
 * ffmpeg clip renders, transcription, voice + music generation) from the shared
 * Postgres queue and drives the scheduler so sequences, scheduled sends and the
 * morning read happen even when nobody has the app open.
 *
 *   DATABASE_URL=postgres://… AUTH_SECRET=… npm run worker
 *
 * Set INLINE_JOBS=0 on the web deployment when this worker is running.
 */
import { claimJob, runJob } from "../src/lib/jobs";
import { tick } from "../src/lib/scheduler";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);
const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 60_000);
let stopping = false;

async function jobsLoop() {
  while (!stopping) {
    try {
      const job = await claimJob();
      if (job) {
        const t0 = Date.now();
        console.log(`[worker] ${job.type} ${job.id} started`);
        await runJob(job);
        console.log(`[worker] ${job.type} ${job.id} finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        continue;
      }
    } catch (e) {
      console.error("[worker] loop error", e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function tickLoop() {
  while (!stopping) {
    try {
      // The worker owns job execution, so the scheduler must not also run jobs inline.
      process.env.INLINE_JOBS = "0";
      const out = await tick();
      console.log("[worker] tick", JSON.stringify(out));
    } catch (e) {
      console.error("[worker] tick error", e);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} — finishing current job then exiting`);
    stopping = true;
    setTimeout(() => process.exit(0), 30_000).unref();
  });
}

console.log("[worker] Pamela OS worker online");
void Promise.all([jobsLoop(), tickLoop()]).then(() => process.exit(0));
