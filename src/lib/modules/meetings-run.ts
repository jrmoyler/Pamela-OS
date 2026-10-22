import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { enqueue, runJob } from "../jobs";

/** Queues a meeting.process job and runs it right away in this process (no worker needed). */
export async function processMeetingNow(meetingId: string, extra: Record<string, unknown> = {}) {
  const db = await getDb();
  const job = await enqueue("meeting.process", { meetingId, ...extra });
  const [claimed] = await db
    .update(schema.jobs)
    .set({ status: "running", lockedAt: new Date(), attempts: 1 })
    .where(eq(schema.jobs.id, job.id))
    .returning();
  await runJob(claimed);
  const [done] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
  return done;
}
