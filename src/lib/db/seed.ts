import { count } from "drizzle-orm";
import type { DB } from "./index";
import * as schema from "./schema";
import { DEFAULT_HOURS } from "../time";

/**
 * Structural defaults only (pipelines, boards, booking types, starter
 * automations). Never inserts people — Pamela's data is hers.
 */
export async function ensureSeed(db: DB) {
  const [{ value: pipelineCount }] = await db.select({ value: count() }).from(schema.pipelines);
  if (Number(pipelineCount) > 0) return;

  const PIPELINES: { name: string; businessLine: string; stages: string[] }[] = [
    { name: "Speaking & Events", businessLine: "A Cup of Compassion", stages: ["Inquiry", "Discovery call", "Proposal sent", "Booked", "Delivered", "Lost"] },
    { name: "LegalShield", businessLine: "LegalShield", stages: ["Lead", "Needs review", "Presentation", "Enrolled", "Follow-up", "Not now"] },
    { name: "Media & Press", businessLine: "Media", stages: ["Pitch", "In conversation", "Scheduled", "Aired / Published", "Passed"] },
    { name: "Schools & Partnerships", businessLine: "Schools", stages: ["Interest", "Meeting", "Proposal", "Partnered", "Closed"] },
    { name: "DR Inquiries", businessLine: "DR", stages: ["New inquiry", "Qualified", "In progress", "Resolved", "Closed"] },
    { name: "Books & Products", businessLine: "A Cup of Compassion", stages: ["Interested", "Invoice sent", "Paid", "Shipped / Delivered"] },
  ];
  for (const [i, p] of PIPELINES.entries()) {
    const [pipe] = await db.insert(schema.pipelines).values({ name: p.name, businessLine: p.businessLine, position: i }).returning();
    await db.insert(schema.pipelineStages).values(
      p.stages.map((name, position) => ({
        pipelineId: pipe.id,
        name,
        position,
        isWon: ["Booked", "Enrolled", "Aired / Published", "Partnered", "Resolved", "Paid", "Delivered", "Shipped / Delivered"].includes(name),
        isLost: ["Lost", "Not now", "Passed", "Closed"].includes(name),
      })),
    );
  }

  const cols = [
    { key: "todo", name: "To do" },
    { key: "doing", name: "In progress" },
    { key: "waiting", name: "Waiting on others" },
    { key: "done", name: "Done" },
  ];
  await db.insert(schema.boards).values([
    { name: "This week", businessLine: null, columns: cols, position: 0 },
    { name: "A Cup of Compassion", businessLine: "A Cup of Compassion", columns: cols, position: 1 },
    { name: "LegalShield", businessLine: "LegalShield", columns: cols, position: 2 },
    { name: "Book & content", businessLine: "Content", columns: cols, position: 3 },
  ]);

  await db.insert(schema.bookingTypes).values([
    { slug: "discovery", name: "Discovery call", description: "A 30-minute conversation to see how A Cup of Compassion can help.", durationMin: 30, hours: DEFAULT_HOURS },
    { slug: "legalshield-review", name: "LegalShield membership review", description: "Walk through LegalShield coverage for your family or business.", durationMin: 45, hours: DEFAULT_HOURS },
    { slug: "speaking", name: "Speaking engagement consult", description: "Plan your event with Pamela.", durationMin: 60, hours: DEFAULT_HOURS },
  ]);

  await db.insert(schema.automations).values([
    {
      name: "New lead → follow-up task",
      description: "Every new lead gets a follow-up task due tomorrow.",
      trigger: "lead.captured",
      actions: [{ type: "create_task", params: { title: "Follow up with {{name}} ({{payload.source}})", dueInDays: 1, priority: "high" } }],
    },
    {
      name: "Urgent call → flag Pamela",
      description: "Urgent receptionist calls become an urgent task at the top of Today.",
      trigger: "call.completed",
      conditions: [{ field: "payload.urgency", op: "eq", value: "urgent" }],
      actions: [{ type: "notify", params: { text: "Urgent call: {{payload.summary}}" } }],
    },
    {
      name: "Booking → thank-you draft",
      description: "RJ drafts a confirmation note for every booking (you approve it).",
      trigger: "booking.created",
      actions: [{ type: "rj_draft", params: { channel: "email", instructions: "Thank them for booking {{payload.bookingType}} on {{payload.startsAtLocal}} and let them know what to expect." } }],
    },
  ]);
}
