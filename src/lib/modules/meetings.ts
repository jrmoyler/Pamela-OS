import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { ActionItem, TranscriptSegment } from "../db/schema";
import { readFile } from "../storage";
import { transcribe } from "../ai/transcribe";
import { aiJson } from "../ai";
import { logActivity, contactName } from "../crm";
import { emit } from "../events";
import { getSetting } from "../settings";
import { zonedParts, zonedToUtc } from "../time";

export type MeetingAnalysis = { summary: string; actionItems: ActionItem[]; speakers: string[]; provider: string };

const STOP = new Set(
  "a an the and or but if then so to of in on at for with from by is are was were be been it this that these those i you he she we they me my our your their them us as not no yes do did does have has had will would can could should just like um uh okay ok yeah really very also about there here what when where who how all any some more most other into out up down over again".split(" "),
);
const ACTION = /\b(i will|i'll|i'm going to|we will|we'll|we need to|need to|needs to|have to|follow up|follow-up|send (you|her|him|them|over|the)|schedule|set up|let's|action item|to-?do|reach out|get back to|make sure|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|end of (the )?(day|week|month)))\b/i;
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function sentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter((s) => s.split(" ").length >= 3);
}

/** Deterministic fallback: extractive summary + action-item heuristics. */
export function analyzeHeuristically(segments: TranscriptSegment[], transcript: string): MeetingAnalysis {
  const speakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean))];
  const units: { text: string; speaker?: string }[] = segments.length
    ? segments.flatMap((seg) => (sentences(seg.text).length ? sentences(seg.text) : [seg.text]).map((t) => ({ text: t, speaker: seg.speaker })))
    : sentences(transcript).map((t) => ({ text: t }));
  const freq = new Map<string, number>();
  for (const u of units) for (const w of u.text.toLowerCase().match(/[a-z']+/g) ?? []) if (!STOP.has(w) && w.length > 2) freq.set(w, (freq.get(w) ?? 0) + 1);
  const scored = units.map((u, i) => {
    const words = u.text.toLowerCase().match(/[a-z']+/g) ?? [];
    const score = words.reduce((s, w) => s + (freq.get(w) ?? 0), 0) / Math.max(4, words.length);
    return { i, text: u.text, score };
  });
  const keep = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(5, Math.max(2, Math.ceil(units.length / 5))))
      .map((s) => s.i),
  );
  const summary = scored
    .filter((s) => keep.has(s.i))
    .map((s) => s.text)
    .join(" ")
    .slice(0, 1200);
  const seen = new Set<string>();
  const actionItems: ActionItem[] = [];
  for (const u of units) {
    if (!ACTION.test(u.text)) continue;
    const key = u.text.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    const due = u.text.match(/\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|end of (?:the )?(?:day|week|month))\b/i)?.[1];
    const owner = /^(i|i'll|i will|i'm)\b/i.test(u.text) ? u.speaker : undefined;
    actionItems.push({ text: u.text.replace(/^(so|and|okay|ok|um|uh),?\s+/i, ""), owner, due });
    if (actionItems.length >= 12) break;
  }
  return { summary: summary || transcript.slice(0, 400), actionItems, speakers, provider: "heuristic" };
}

export async function analyzeMeeting(title: string, segments: TranscriptSegment[], transcript: string): Promise<MeetingAnalysis> {
  const text = segments.length ? segments.map((s) => `${s.speaker}: ${s.text}`).join("\n") : transcript;
  if (!text.trim()) return { summary: "", actionItems: [], speakers: [], provider: "none" };
  const r = await aiJson<{ summary: string; actionItems: { text: string; owner?: string | null; due?: string | null }[]; speakers?: string[] }>(
    "summarize",
    `You are RJ, Pamela's operator at A Cup of Compassion. Summarize meeting transcripts for her CRM.
Return {"summary": "3-6 sentence summary: who, what was decided, open questions", "actionItems": [{"text": "imperative task", "owner": "name or null", "due": "plain-language due date or null"}], "speakers": ["names"]}.
Only include action items actually discussed. Never invent facts.`,
    `Meeting: ${title}\n\nTranscript:\n${text.slice(0, 60_000)}`,
    1800,
  ).catch(() => null);
  if (r?.data?.summary) {
    return {
      summary: r.data.summary,
      actionItems: (r.data.actionItems ?? []).filter((a) => a?.text).map((a) => ({ text: a.text, owner: a.owner ?? undefined, due: a.due ?? undefined })),
      speakers: r.data.speakers?.length ? r.data.speakers : [...new Set(segments.map((s) => s.speaker))],
      provider: r.provider,
    };
  }
  return analyzeHeuristically(segments, transcript);
}

/** Turns "Friday", "tomorrow", "next week", "end of month" into a due instant (5pm local). */
export function parseDue(due: string | undefined, tz: string, now = new Date()): Date {
  const p = zonedParts(now, tz);
  const at = (addDays: number) => zonedToUtc(p.year, p.month, p.day + addDays, 17, 0, tz);
  const d = (due ?? "").toLowerCase();
  if (!d) return at(3);
  if (d.includes("tomorrow")) return at(1);
  if (d.includes("today") || d.includes("end of day") || d.includes("end of the day")) return at(0);
  if (d.includes("next week")) return at(7);
  if (d.includes("end of week") || d.includes("end of the week")) return at(Math.max(0, 5 - p.weekday));
  if (d.includes("month")) return at(14);
  const wd = WEEKDAYS.findIndex((w) => d.includes(w));
  if (wd >= 0) {
    let diff = wd + 1 - p.weekday;
    if (diff <= 0) diff += 7;
    return at(diff);
  }
  const parsed = new Date(due!);
  return Number.isNaN(parsed.getTime()) ? at(3) : parsed;
}

/** Creates tasks for action items that don't have one yet. Returns the updated items. */
export async function createTasksForMeeting(meetingId: string, onlyIndexes?: number[]) {
  const db = await getDb();
  const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meetingId));
  if (!m) throw new Error("Meeting not found");
  const tz = await getSetting("timezone");
  const items = [...m.actionItems];
  let created = 0;
  for (const [i, item] of items.entries()) {
    if (item.taskId || (onlyIndexes && !onlyIndexes.includes(i))) continue;
    const [t] = await db
      .insert(schema.tasks)
      .values({
        title: item.text.slice(0, 240),
        description: `From meeting “${m.title}”${item.owner ? ` · owner: ${item.owner}` : ""}${item.due ? ` · due: ${item.due}` : ""}`,
        dueAt: parseDue(item.due, tz),
        contactId: m.contactId,
        dealId: m.dealId,
        meetingId: m.id,
        source: "meeting",
      })
      .returning();
    items[i] = { ...item, taskId: t.id };
    created++;
    await emit("task.created", { taskId: t.id, contactId: m.contactId, source: "meeting" }, "meetings");
  }
  await db.update(schema.meetings).set({ actionItems: items }).where(eq(schema.meetings.id, meetingId));
  return { items, created };
}

/**
 * Job handler: transcribe (server Whisper if connected, else the live browser
 * transcript), summarise, create tasks, write the CRM timeline, emit event.
 */
export async function processMeetingJob(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const meetingId = String(payload.meetingId);
  const db = await getDb();
  const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meetingId));
  if (!m) throw new Error("Meeting not found");
  await db.update(schema.meetings).set({ status: "processing", error: null }).where(eq(schema.meetings.id, m.id));
  try {
    let segments = m.segments;
    let transcript = m.transcript ?? segments.map((s) => s.text).join(" ");
    let transcriber = "browser";
    if (m.audioFileId && payload.retranscribe !== false) {
      const file = await readFile(m.audioFileId);
      if (file) {
        const t = await transcribe(file.data, file.name, file.mime);
        if (t?.text) {
          // Keep the speaker labels Pamela set live when the server returns unlabeled segments.
          segments = t.segments.map((s) => ({ ...s, speaker: s.speaker && s.speaker !== "Speaker" ? s.speaker : nearestSpeaker(m.segments, s.start) }));
          transcript = t.text;
          transcriber = t.provider;
        }
      }
    }
    if (!transcript.trim()) throw new Error("No transcript: nothing was captured and no transcription service is connected.");
    const a = await analyzeMeeting(m.title, segments, transcript);
    const keepTaskIds = new Map(m.actionItems.filter((x) => x.taskId).map((x) => [x.text, x.taskId]));
    const actionItems = a.actionItems.map((x) => ({ ...x, taskId: keepTaskIds.get(x.text) }));
    await db
      .update(schema.meetings)
      .set({ transcript, segments, summary: a.summary, actionItems, speakers: a.speakers.length ? a.speakers : m.speakers, status: "ready" })
      .where(eq(schema.meetings.id, m.id));
    const { items, created } = payload.createTasks === false ? { items: actionItems, created: 0 } : await createTasksForMeeting(m.id);
    if (!payload.reprocess) {
      await logActivity({
        type: "meeting",
        direction: "internal",
        contactId: m.contactId,
        dealId: m.dealId,
        title: `Meeting: ${m.title}`,
        body: `${a.summary}${items.length ? `\n\nAction items:\n${items.map((i) => `• ${i.text}`).join("\n")}` : ""}`,
        subjectType: "meeting",
        subjectId: m.id,
        meta: { durationSec: m.durationSec, transcriber, summarizer: a.provider },
      });
    }
    await emit("meeting.processed", { meetingId: m.id, contactId: m.contactId, actionItems: items.length, title: m.title }, "meetings");
    return { transcriber, summarizer: a.provider, actionItems: items.length, tasksCreated: created };
  } catch (e) {
    await db.update(schema.meetings).set({ status: "failed", error: (e as Error).message }).where(eq(schema.meetings.id, m.id));
    throw e;
  }
}

function nearestSpeaker(live: TranscriptSegment[], at: number) {
  let best = live[0]?.speaker ?? "Speaker";
  for (const s of live) if (s.start <= at) best = s.speaker;
  return best;
}

export async function meetingContactLabel(contactId: string | null) {
  if (!contactId) return null;
  const db = await getDb();
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
  return c ? contactName(c) : null;
}
