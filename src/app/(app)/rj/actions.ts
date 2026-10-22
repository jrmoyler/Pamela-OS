"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { createThread, runRj } from "@/lib/rj/agent";
import { buildBriefing } from "@/lib/rj/briefing";

export async function sendToRj(threadId: string | null, form: FormData) {
  const text = String(form.get("text") ?? "").trim();
  if (!text) return;
  const id = threadId ?? (await createThread(text.slice(0, 60))).id;
  await runRj(id, text);
  if (!threadId) redirect(`/rj?t=${id}`);
  revalidatePath("/rj");
}

export async function deleteThread(id: string) {
  const db = await getDb();
  await db.delete(schema.rjThreads).where(eq(schema.rjThreads.id, id));
  redirect("/rj");
}

export async function refreshBriefing() {
  await buildBriefing();
  revalidatePath("/");
}
