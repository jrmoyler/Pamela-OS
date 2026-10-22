"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { putFile } from "@/lib/storage";
import { getSetting } from "@/lib/settings";
import { zonedToUtc } from "@/lib/time";
import { createApproval } from "@/lib/approvals";
import { draftInHerVoice } from "@/lib/rj/voice";
import { handleComment, handleInboundDm, type Platform } from "@/lib/modules/social";
import { requireSession } from "@/lib/auth";

const platformOf = (v: FormDataEntryValue | null): Platform => (v === "facebook" ? "facebook" : "instagram");
const tagList = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/* ───────────── Comment-to-DM triggers ───────────── */

export async function saveTrigger(form: FormData) {
  await requireSession();
  const db = await getDb();
  const id = String(form.get("id") || "");
  const values = {
    name: String(form.get("name") || form.get("keyword") || "Trigger"),
    platform: platformOf(form.get("platform")),
    keyword: String(form.get("keyword") || "").trim(),
    postId: String(form.get("postId") || "").trim() || null,
    dmMessage: String(form.get("dmMessage") || "").trim(),
    pageSlug: String(form.get("pageSlug") || "") || null,
    tags: tagList(form.get("tags")),
    autoApprove: false,
  };
  if (!values.keyword || !values.dmMessage) throw new Error("Keyword and DM message are required.");
  if (id) await db.update(schema.socialTriggers).set(values).where(eq(schema.socialTriggers.id, id));
  else await db.insert(schema.socialTriggers).values(values);
  redirect("/social");
}

export async function toggleTrigger(id: string, enabled: boolean) {
  await requireSession();
  const db = await getDb();
  await db.update(schema.socialTriggers).set({ enabled }).where(eq(schema.socialTriggers.id, id));
  revalidatePath("/social");
}

export async function deleteTrigger(id: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.socialTriggers).where(eq(schema.socialTriggers.id, id));
  revalidatePath("/social");
}

/** Runs the exact webhook handler with a fake comment — testable without Meta. */
export async function simulateComment(form: FormData) {
  await requireSession();
  const platform = platformOf(form.get("platform"));
  const kind = String(form.get("kind") || "comment");
  const username = String(form.get("username") || "test.follower").trim();
  const text = String(form.get("text") || "").trim();
  const fromId = `sim_${username.replace(/\W/g, "").toLowerCase() || "user"}`;
  if (kind === "dm") {
    const r = await handleInboundDm({ platform, senderId: fromId, text, messageId: `sim_m_${Date.now()}` });
    redirect(`/social?sim=${r.approvalId ? "dm" : "logged"}`);
  }
  const r = await handleComment({ platform, commentId: `sim_c_${Date.now()}`, text, fromId, fromName: username, postId: String(form.get("postId") || "") || undefined });
  redirect(`/social?sim=${r.matched ? "matched" : "nomatch"}`);
}

/* ───────────── Posts ───────────── */

export async function createPost(form: FormData) {
  await requireSession();
  const db = await getDb();
  const caption = String(form.get("caption") || "").trim();
  if (!caption) throw new Error("Write a caption first.");
  const platforms = form.getAll("platforms").map((p) => platformOf(p));
  if (!platforms.length) throw new Error("Pick at least one platform.");
  let mediaFileId: string | null = null;
  const file = form.get("media");
  if (file instanceof File && file.size > 0) {
    const saved = await putFile(Buffer.from(await file.arrayBuffer()), file.name, file.type || "application/octet-stream");
    mediaFileId = saved.id;
  }
  if (platforms.includes("instagram") && !mediaFileId) throw new Error("Instagram posts need a photo or video.");
  // datetime-local is wall-clock time in Pamela's timezone.
  const when = String(form.get("scheduledFor") || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const tz = await getSetting("timezone");
  const scheduledFor = when ? zonedToUtc(+when[1], +when[2], +when[3], +when[4], +when[5], tz) : undefined;
  for (const platform of [...new Set(platforms)]) {
    const [post] = await db
      .insert(schema.socialPosts)
      .values({ platform, caption, mediaFileId, status: "awaiting_approval", scheduledFor: scheduledFor ?? null })
      .returning();
    await createApproval({
      kind: "social_post",
      title: `Post to ${platform}${scheduledFor ? ` (scheduled)` : ""}`,
      summary: caption.slice(0, 200),
      payload: { socialPostId: post.id, caption } as { socialPostId: string },
      subjectType: "social_post",
      subjectId: post.id,
      scheduledFor,
    });
  }
  redirect("/approvals");
}

export async function draftCaption(form: FormData) {
  await requireSession();
  const about = String(form.get("about") || "").trim();
  if (!about) redirect("/social/posts");
  const draft = await draftInHerVoice({
    channel: "dm",
    instructions: `Write a social media caption (warm, 1–3 short paragraphs, up to 5 relevant hashtags, end with a gentle call to action) about: ${about}`,
  });
  redirect(`/social/posts?caption=${encodeURIComponent(draft.body.replace(/^Hi friend,?\s*(it's Pamela with A Cup of Compassion\.)?\s*/i, ""))}`);
}

export async function deletePost(id: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(schema.socialPosts).where(eq(schema.socialPosts.id, id));
  revalidatePath("/social/posts");
}
