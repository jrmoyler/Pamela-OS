"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { testAutomation } from "@/lib/automations";
import { runJob } from "@/lib/jobs";
import { safeJson } from "@/lib/ai";
import type { AutomationAction, AutomationCondition } from "@/lib/db/schema";

function parse(form: FormData) {
  return {
    name: String(form.get("name") ?? "Untitled"),
    description: String(form.get("description") ?? "") || null,
    trigger: String(form.get("trigger")),
    conditions: (safeJson<AutomationCondition[]>(String(form.get("conditions"))) ?? []).filter((c) => c.field),
    actions: (safeJson<AutomationAction[]>(String(form.get("actions"))) ?? []).filter((a) => a.type),
  };
}

export async function saveAutomation(id: string | null, form: FormData) {
  const db = await getDb();
  const data = parse(form);
  if (id) await db.update(schema.automations).set(data).where(eq(schema.automations.id, id));
  else await db.insert(schema.automations).values(data);
  redirect("/automations");
}

export async function toggleAutomation(id: string, enabled: boolean) {
  const db = await getDb();
  await db.update(schema.automations).set({ enabled }).where(eq(schema.automations.id, id));
  revalidatePath("/automations");
}

export async function deleteAutomation(id: string) {
  const db = await getDb();
  await db.delete(schema.automations).where(eq(schema.automations.id, id));
  revalidatePath("/automations");
}

export async function runTest(id: string, form: FormData) {
  const payload = safeJson<Record<string, unknown>>(String(form.get("payload") || "{}")) ?? {};
  const contactId = String(form.get("contactId") || "");
  if (contactId) payload.contactId = contactId;
  await testAutomation(id, payload);
  redirect("/automations?tab=runs");
}

export async function retryJob(id: string) {
  const db = await getDb();
  const [job] = await db.update(schema.jobs).set({ status: "running", attempts: 0, lockedAt: new Date(), error: null }).where(eq(schema.jobs.id, id)).returning();
  if (job) await runJob(job);
  revalidatePath("/automations");
}
