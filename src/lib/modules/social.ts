import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { findOrCreateContact, logActivity, contactName } from "../crm";
import { emit } from "../events";
import { createApproval } from "../approvals";
import { appUrl } from "../outbound";
import { draftInHerVoice } from "../rj/voice";

export type Platform = "instagram" | "facebook";

export type CommentEvent = { platform: Platform; commentId: string; text: string; fromId: string; fromName?: string; postId?: string };
export type DmEvent = { platform: Platform; senderId: string; text: string; messageId?: string };

function keywordMatches(text: string, keyword: string) {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  const t = text.toLowerCase();
  return new RegExp(`(^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(t);
}

async function seen(key: "commentId" | "messageId", id: string) {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.activities.id })
    .from(schema.activities)
    .where(sql`${schema.activities.meta} ->> ${key} = ${id}`)
    .limit(1);
  return rows.length > 0;
}

/**
 * Comment-to-DM. A comment that matches an active trigger keyword becomes a
 * lead in the CRM and a private-reply DM waiting in Approvals.
 */
export async function handleComment(e: CommentEvent): Promise<{ matched: boolean; approvalId?: string; contactId?: string; duplicate?: boolean }> {
  if (await seen("commentId", e.commentId)) return { matched: false, duplicate: true };
  const db = await getDb();
  const triggers = await db
    .select()
    .from(schema.socialTriggers)
    .where(and(eq(schema.socialTriggers.enabled, true), eq(schema.socialTriggers.platform, e.platform)));
  const trigger = triggers.find((t) => (!t.postId || t.postId === e.postId) && keywordMatches(e.text, t.keyword));

  if (!trigger) {
    await logActivity({ type: "social", direction: "inbound", title: `${e.platform} comment from ${e.fromName ?? e.fromId}`, body: e.text, meta: { commentId: e.commentId, postId: e.postId ?? null, platform: e.platform } });
    await emit("social.comment", { platform: e.platform, text: e.text, contactId: null, triggerId: null }, "social");
    return { matched: false };
  }

  const { contact, created } = await findOrCreateContact({
    name: e.fromName ?? null,
    socialHandles: { [e.platform]: e.fromId },
    source: `${e.platform} comment`,
    tags: trigger.tags,
  });
  await logActivity({
    type: "social",
    direction: "inbound",
    contactId: contact.id,
    title: `Commented “${trigger.keyword}” on ${e.platform}`,
    body: e.text,
    meta: { commentId: e.commentId, postId: e.postId ?? null, triggerId: trigger.id, platform: e.platform },
  });
  await db.update(schema.socialTriggers).set({ hits: sql`${schema.socialTriggers.hits} + 1` }).where(eq(schema.socialTriggers.id, trigger.id));
  if (created) await emit("contact.created", { contactId: contact.id, source: `${e.platform} comment` }, "social");
  await emit("social.comment", { platform: e.platform, text: e.text, contactId: contact.id, triggerId: trigger.id }, "social");
  await emit("lead.captured", { contactId: contact.id, source: `${e.platform} comment`, triggerId: trigger.id }, "social");

  const message = trigger.pageSlug ? `${trigger.dmMessage}\n\n${appUrl()}/p/${trigger.pageSlug}` : trigger.dmMessage;
  const approval = await createApproval({
    kind: "dm",
    title: `${e.platform} DM to ${contactName(contact)} (“${trigger.keyword}”)`,
    summary: `Comment: “${e.text.slice(0, 200)}”`,
    payload: { platform: e.platform, recipientId: e.fromId, message, commentId: e.commentId },
    contactId: contact.id,
    createdBy: "automation",
    subjectType: "social_trigger",
    subjectId: trigger.id,
  });
  return { matched: true, approvalId: approval.id, contactId: contact.id };
}

/** Inbound DM → timeline + an RJ-drafted reply in Approvals. */
export async function handleInboundDm(e: DmEvent): Promise<{ approvalId?: string; contactId: string; duplicate?: boolean }> {
  if (e.messageId && (await seen("messageId", e.messageId))) return { contactId: "", duplicate: true };
  const { contact, created } = await findOrCreateContact({ socialHandles: { [e.platform]: e.senderId }, source: `${e.platform} DM` });
  await logActivity({ type: "dm", direction: "inbound", contactId: contact.id, title: `${e.platform} DM`, body: e.text, meta: { messageId: e.messageId ?? null, platform: e.platform } });
  if (created) await emit("contact.created", { contactId: contact.id, source: `${e.platform} DM` }, "social");
  await emit("social.dm", { platform: e.platform, text: e.text, contactId: contact.id }, "social");
  if (!e.text.trim()) return { contactId: contact.id };
  const draft = await draftInHerVoice({ channel: "dm", instructions: `Reply helpfully to this message: “${e.text.slice(0, 1000)}”`, contact });
  const approval = await createApproval({
    kind: "dm",
    title: `Reply to ${contactName(contact)} on ${e.platform}`,
    summary: `They wrote: “${e.text.slice(0, 200)}”`,
    payload: { platform: e.platform, recipientId: e.senderId, message: draft.body },
    contactId: contact.id,
    createdBy: "rj",
  });
  return { approvalId: approval.id, contactId: contact.id };
}

type GraphChange = { field: string; value: Record<string, unknown> };
type GraphMessaging = { sender?: { id: string }; recipient?: { id: string }; message?: { mid?: string; text?: string; is_echo?: boolean } };
type GraphEntry = { id: string; changes?: GraphChange[]; messaging?: GraphMessaging[] };

/** Parses a Meta webhook body (Instagram or Page object) and dispatches each event. */
export async function handleMetaWebhook(body: { object?: string; entry?: GraphEntry[] }) {
  const platform: Platform = body.object === "instagram" ? "instagram" : "facebook";
  const results: unknown[] = [];
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      const from = (v.from ?? {}) as { id?: string; username?: string; name?: string };
      if (platform === "instagram" && ch.field === "comments" && v.id && from.id && from.id !== entry.id) {
        results.push(
          await handleComment({ platform, commentId: String(v.id), text: String(v.text ?? ""), fromId: from.id, fromName: from.username, postId: (v.media as { id?: string } | undefined)?.id }),
        );
      }
      if (platform === "facebook" && ch.field === "feed" && v.item === "comment" && v.verb === "add" && from.id && from.id !== entry.id) {
        results.push(
          await handleComment({ platform, commentId: String(v.comment_id), text: String(v.message ?? ""), fromId: from.id, fromName: from.name, postId: v.post_id ? String(v.post_id) : undefined }),
        );
      }
    }
    for (const m of entry.messaging ?? []) {
      if (!m.message || m.message.is_echo || !m.sender?.id || m.sender.id === entry.id) continue;
      results.push(await handleInboundDm({ platform, senderId: m.sender.id, text: m.message.text ?? "", messageId: m.message.mid }));
    }
  }
  return results;
}
