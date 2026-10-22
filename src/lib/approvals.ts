import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "./db";
import { lintBrand, autoFixBrand } from "./brand";
import { getSetting } from "./settings";
import { logActivity, contactName } from "./crm";
import { emit } from "./events";
import { readFile } from "./storage";
import {
  sendEmail,
  sendSms,
  sendDm,
  publishSocial,
  placeVoiceDrop,
  signedMediaUrl,
  appUrl,
  type DeliveryResult,
} from "./outbound";

export type Approval = typeof schema.approvals.$inferSelect;

/**
 * Payload contracts per approval kind. Modules create approvals with these
 * shapes; the executor below is the ONLY place outbound delivery happens.
 */
export type ApprovalPayloads = {
  email: { to: string; subject: string; body: string };
  sms: { to: string; body: string };
  dm: { platform: "instagram" | "facebook"; recipientId: string; message: string; commentId?: string };
  social_post: { socialPostId: string; caption?: string };
  clip_post: { videoId: string; clipId: string; platforms: ("instagram" | "facebook")[]; caption: string };
  charge: { paymentId: string; channel: "email" | "sms"; to: string; message: string };
  publish_page: { pageId: string; slug?: string };
  campaign_send: { campaignId: string; subject?: string; body?: string };
  voice_send: { voiceDraftId: string; to: string; channel: "sms" | "call" };
  song_release: { songId: string; platforms?: ("instagram" | "facebook")[]; caption?: string };
  design_publish: { designId: string; platforms: ("instagram" | "facebook")[]; caption: string };
};
export type ApprovalKind = keyof ApprovalPayloads;

export const KIND_LABELS: Record<ApprovalKind, string> = {
  email: "Email",
  sms: "Text message",
  dm: "Direct message",
  social_post: "Social post",
  clip_post: "Video clip post",
  charge: "Payment request",
  publish_page: "Publish page",
  campaign_send: "Campaign send",
  voice_send: "Voice message",
  song_release: "Song release",
  design_publish: "Design publish",
};

const TEXT_FIELDS = ["subject", "body", "message", "caption", "script"];

function brandIssuesFor(payload: Record<string, unknown>, kit: Awaited<ReturnType<typeof getSetting<"brandKit">>>) {
  const text = TEXT_FIELDS.map((f) => (typeof payload[f] === "string" ? (payload[f] as string) : "")).join("\n");
  return lintBrand(text, kit).map((i) => i.message);
}

export async function createApproval<K extends ApprovalKind>(a: {
  kind: K;
  title: string;
  summary?: string;
  payload: ApprovalPayloads[K];
  contactId?: string | null;
  subjectType?: string;
  subjectId?: string;
  createdBy?: "user" | "rj" | "automation" | "receptionist" | "sequence";
  scheduledFor?: Date;
}): Promise<Approval> {
  const db = await getDb();
  const kit = await getSetting("brandKit");
  const payload = a.payload as unknown as Record<string, unknown>;
  const [row] = await db
    .insert(schema.approvals)
    .values({
      kind: a.kind,
      title: a.title,
      summary: a.summary ?? null,
      payload,
      contactId: a.contactId ?? null,
      subjectType: a.subjectType ?? null,
      subjectId: a.subjectId ?? null,
      createdBy: a.createdBy ?? "user",
      scheduledFor: a.scheduledFor ?? null,
      brandIssues: brandIssuesFor(payload, kit),
    })
    .returning();
  await emit("approval.requested", { approvalId: row.id, kind: row.kind, title: row.title, contactId: row.contactId }, "approvals");
  return row;
}

export async function updateApprovalPayload(id: string, patch: Record<string, unknown>) {
  const db = await getDb();
  const [cur] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, id));
  if (!cur || cur.status !== "pending") throw new Error("Only pending approvals can be edited.");
  const payload = { ...cur.payload, ...patch };
  const kit = await getSetting("brandKit");
  // Guard on status so an edit can't land after the item was approved/sent.
  const [updated] = await db
    .update(schema.approvals)
    .set({ payload, brandIssues: brandIssuesFor(payload, kit) })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "pending")))
    .returning({ id: schema.approvals.id });
  if (!updated) throw new Error("Only pending approvals can be edited.");
}

export async function applyBrandFixes(id: string) {
  const db = await getDb();
  const [cur] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, id));
  if (!cur) return;
  const kit = await getSetting("brandKit");
  const patch: Record<string, unknown> = {};
  for (const f of TEXT_FIELDS) if (typeof cur.payload[f] === "string") patch[f] = autoFixBrand(cur.payload[f] as string, kit);
  await updateApprovalPayload(id, patch);
}

export async function rejectApproval(id: string, reason?: string) {
  const db = await getDb();
  const [row] = await db
    .update(schema.approvals)
    .set({ status: "rejected", decidedAt: new Date(), error: reason ?? null })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "pending")))
    .returning();
  if (row) {
    // Hand the item back to her as an editable draft instead of leaving it stuck "awaiting approval".
    const table = (
      { campaign: schema.campaigns, social_post: schema.socialPosts, voice_draft: schema.voiceDrafts, design: schema.designs } as const
    )[row.subjectType as "campaign" | "social_post" | "voice_draft" | "design"];
    if (table && row.subjectId) {
      await db.update(table).set({ status: "draft" }).where(and(eq(table.id, row.subjectId), eq(table.status, "awaiting_approval")));
    }
    await emit("approval.rejected", { approvalId: id, kind: row.kind }, "approvals");
  }
  return row;
}

/** Pamela's yes. Marks approved, then performs the delivery (now, or at its scheduled time). */
export async function approveAndExecute(id: string): Promise<Approval> {
  const db = await getDb();
  const [row] = await db
    .update(schema.approvals)
    .set({ status: "approved", decidedAt: new Date() })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "pending")))
    .returning();
  if (!row) throw new Error("This item is no longer pending.");
  if (row.scheduledFor && row.scheduledFor.getTime() > Date.now()) return row; // the scheduler sends it later
  return (await executeAndRecord(row)) ?? row;
}

/** Sends approved items whose scheduled time has arrived. */
export async function runDueApprovals(now = new Date()) {
  const db = await getDb();
  const due = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.status, "approved"), lte(schema.approvals.scheduledFor, now), isNull(schema.approvals.executedAt)))
    .limit(50);
  let sent = 0;
  for (const row of due) if (await executeAndRecord(row)) sent++;
  return sent;
}

/**
 * Atomically claims an approved row (executedAt null → now) so that the
 * scheduler running in several places (cron, worker, heartbeat) and
 * approveAndExecute can never deliver the same item twice.
 */
async function claimForExecution(id: string): Promise<Approval | null> {
  const db = await getDb();
  const [claimed] = await db
    .update(schema.approvals)
    .set({ executedAt: new Date() })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "approved"), isNull(schema.approvals.executedAt)))
    .returning();
  return claimed ?? null;
}

async function executeAndRecord(row: Approval): Promise<Approval | null> {
  const db = await getDb();
  const id = row.id;
  const claimed = await claimForExecution(id);
  if (!claimed) return null; // someone else is already delivering it
  let result: ExecResult;
  try {
    result = await execute(claimed);
  } catch (e) {
    const msg = (e as Error).message;
    const [failed] = await db
      .update(schema.approvals)
      .set({ status: "failed", executedAt: new Date(), error: msg })
      .where(eq(schema.approvals.id, id))
      .returning();
    await emit("approval.failed", { approvalId: id, kind: row.kind, error: msg }, "approvals");
    return failed;
  }
  // Delivery succeeded: record it outside the try so a bookkeeping error can
  // never flip a delivered item to "failed" (and invite a duplicate retry).
  const [done] = await db
    .update(schema.approvals)
    .set({ status: "sent", executedAt: new Date(), result: result as unknown as Record<string, unknown>, error: null })
    .where(eq(schema.approvals.id, id))
    .returning();
  await emit("approval.executed", { approvalId: id, kind: row.kind, contactId: row.contactId, simulated: result.simulated }, "approvals");
  return done;
}

/** Failed items can be put back in the queue after fixing the connection. */
export async function retryApproval(id: string) {
  const db = await getDb();
  await db
    .update(schema.approvals)
    .set({ status: "pending", error: null, decidedAt: null, executedAt: null })
    .where(and(eq(schema.approvals.id, id), inArray(schema.approvals.status, ["failed"])));
}

type ExecResult = DeliveryResult & { deliveries?: DeliveryResult[] };

async function execute(a: Approval): Promise<ExecResult> {
  const db = await getDb();
  const p = a.payload as Record<string, unknown>;
  const sandboxTag = (r: DeliveryResult) => (r.simulated ? " (sandbox)" : "");
  switch (a.kind as ApprovalKind) {
    case "email": {
      const e = p as ApprovalPayloads["email"];
      const r = await sendEmail(e);
      await logActivity({ type: "email", direction: "outbound", contactId: a.contactId, title: `Email sent${sandboxTag(r)}: ${e.subject}`, body: e.body, meta: { to: e.to, approvalId: a.id } });
      return r;
    }
    case "sms": {
      const s = p as ApprovalPayloads["sms"];
      const r = await sendSms(s);
      await logActivity({ type: "sms", direction: "outbound", contactId: a.contactId, title: `Text sent${sandboxTag(r)}`, body: s.body, meta: { to: s.to, approvalId: a.id } });
      return r;
    }
    case "dm": {
      const d = p as ApprovalPayloads["dm"];
      const r = await sendDm(d);
      await logActivity({ type: "dm", direction: "outbound", contactId: a.contactId, title: `${d.platform} DM sent${sandboxTag(r)}`, body: d.message, meta: { approvalId: a.id } });
      return r;
    }
    case "social_post": {
      const { socialPostId } = p as ApprovalPayloads["social_post"];
      const [post] = await db.select().from(schema.socialPosts).where(eq(schema.socialPosts.id, socialPostId));
      if (!post) throw new Error("Post no longer exists.");
      const media = post.mediaFileId ? await db.select().from(schema.files).where(eq(schema.files.id, post.mediaFileId)).then((r) => r[0]) : null;
      const r = await publishSocial({
        platform: post.platform as "instagram" | "facebook",
        caption: post.caption,
        mediaUrl: media ? signedMediaUrl(media.id) : undefined,
        isVideo: media?.kind === "video",
      });
      await db.update(schema.socialPosts).set({ status: "published", publishedAt: new Date(), externalId: r.providerId ?? null }).where(eq(schema.socialPosts.id, post.id));
      await logActivity({ type: "social", direction: "outbound", title: `Posted to ${post.platform}${sandboxTag(r)}`, body: post.caption, subjectType: "social_post", subjectId: post.id });
      return r;
    }
    case "clip_post": {
      const c = p as ApprovalPayloads["clip_post"];
      const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, c.videoId));
      if (!video) throw new Error("Video no longer exists.");
      const clip = video.clips.find((x) => x.id === c.clipId);
      if (!clip) throw new Error("Clip no longer exists.");
      const mediaId = clip.renderedFileId ?? video.sourceFileId;
      const deliveries: DeliveryResult[] = [];
      for (const platform of c.platforms) {
        const r = await publishSocial({ platform, caption: c.caption, mediaUrl: mediaId ? signedMediaUrl(mediaId) : undefined, isVideo: true });
        deliveries.push(r);
        await db.insert(schema.socialPosts).values({
          platform,
          caption: c.caption,
          mediaFileId: mediaId,
          status: "published",
          publishedAt: new Date(),
          externalId: r.providerId ?? null,
          sourceType: "video_clip",
          sourceId: video.id,
        });
      }
      const clips = video.clips.map((x) => (x.id === clip.id ? { ...x, status: "posted" as const } : x));
      await db.update(schema.videos).set({ clips }).where(eq(schema.videos.id, video.id));
      await logActivity({ type: "social", direction: "outbound", title: `Clip “${clip.hook}” posted to ${c.platforms.join(" + ")}${sandboxTag(deliveries[0] ?? { ok: true, simulated: true })}`, body: c.caption, subjectType: "video", subjectId: video.id });
      return { ok: true, simulated: deliveries.every((d) => d.simulated), deliveries };
    }
    case "charge": {
      const c = p as ApprovalPayloads["charge"];
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, c.paymentId));
      if (!payment) throw new Error("Payment request no longer exists.");
      const link = `${appUrl()}/pay/${payment.id}`;
      const message = c.message.includes(link) ? c.message : `${c.message}\n\n${link}`;
      const r = c.channel === "email" ? await sendEmail({ to: c.to, subject: payment.description, body: message }) : await sendSms({ to: c.to, body: message });
      await logActivity({ type: "purchase", direction: "outbound", contactId: payment.contactId, title: `Payment request sent${sandboxTag(r)}: $${(payment.amountCents / 100).toFixed(2)}`, body: payment.description, subjectType: "payment", subjectId: payment.id });
      return { ...r, url: link };
    }
    case "publish_page": {
      const { pageId } = p as ApprovalPayloads["publish_page"];
      const [page] = await db.update(schema.pages).set({ published: true, updatedAt: new Date() }).where(eq(schema.pages.id, pageId)).returning();
      if (!page) throw new Error("Page no longer exists.");
      await logActivity({ type: "system", title: `Published page /p/${page.slug}`, subjectType: "page", subjectId: page.id });
      return { ok: true, simulated: false, url: `${appUrl()}/p/${page.slug}` };
    }
    case "campaign_send": {
      const { campaignId } = p as ApprovalPayloads["campaign_send"];
      const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
      if (!campaign) throw new Error("Campaign no longer exists.");
      const audience = await campaignAudience(campaign.audienceTags, campaign.channel);
      await db.update(schema.campaigns).set({ status: "sending" }).where(eq(schema.campaigns.id, campaign.id));
      const deliveries: DeliveryResult[] = [];
      let failures = 0;
      for (const c of audience) {
        const body = personalize(campaign.body, c);
        try {
          const r =
            campaign.channel === "sms"
              ? await sendSms({ to: c.phone!, body })
              : await sendEmail({ to: c.email!, subject: personalize(campaign.subject ?? campaign.name, c), body });
          deliveries.push(r);
          await logActivity({ type: campaign.channel === "sms" ? "sms" : "email", direction: "outbound", contactId: c.id, title: `Campaign “${campaign.name}”${sandboxTag(r)}`, body, subjectType: "campaign", subjectId: campaign.id });
        } catch (e) {
          failures++;
          await logActivity({ type: "system", contactId: c.id, title: `Campaign “${campaign.name}” failed`, body: (e as Error).message });
        }
      }
      await db.update(schema.campaigns).set({ status: "sent", sentAt: new Date(), recipients: deliveries.length }).where(eq(schema.campaigns.id, campaign.id));
      if (failures && !deliveries.length) throw new Error(`All ${failures} sends failed.`);
      return { ok: true, simulated: deliveries.every((d) => d.simulated), detail: `${deliveries.length} sent, ${failures} failed` };
    }
    case "voice_send": {
      const v = p as ApprovalPayloads["voice_send"];
      const [draft] = await db.select().from(schema.voiceDrafts).where(eq(schema.voiceDrafts.id, v.voiceDraftId));
      if (!draft?.audioFileId) throw new Error("Voice draft has no rendered audio yet.");
      if (!(await readFile(draft.audioFileId))) throw new Error("Rendered audio file is missing.");
      const url = signedMediaUrl(draft.audioFileId);
      const r = v.channel === "call" ? await placeVoiceDrop({ to: v.to, audioUrl: url }) : await sendSms({ to: v.to, body: "A voice message from Pamela 💜", mediaUrl: url });
      await db.update(schema.voiceDrafts).set({ status: "sent" }).where(eq(schema.voiceDrafts.id, draft.id));
      await logActivity({ type: v.channel === "call" ? "call" : "sms", direction: "outbound", contactId: draft.contactId, title: `Voice message sent${sandboxTag(r)}`, body: draft.script, subjectType: "voice_draft", subjectId: draft.id });
      return r;
    }
    case "song_release": {
      const s = p as ApprovalPayloads["song_release"];
      const [song] = await db.select().from(schema.songs).where(eq(schema.songs.id, s.songId));
      if (!song) throw new Error("Song no longer exists.");
      const deliveries: DeliveryResult[] = [];
      for (const platform of s.platforms ?? []) {
        deliveries.push(await publishSocial({ platform, caption: s.caption ?? `New music: “${song.title}”`, mediaUrl: song.audioFileId ? signedMediaUrl(song.audioFileId) : undefined, isVideo: false }));
      }
      await db.update(schema.songs).set({ status: "released", releaseDate: song.releaseDate ?? new Date() }).where(eq(schema.songs.id, song.id));
      await logActivity({ type: "system", title: `Released “${song.title}”`, subjectType: "song", subjectId: song.id });
      return { ok: true, simulated: deliveries.length ? deliveries.every((d) => d.simulated) : false, deliveries };
    }
    case "design_publish": {
      const d = p as ApprovalPayloads["design_publish"];
      const [design] = await db.select().from(schema.designs).where(eq(schema.designs.id, d.designId));
      if (!design) throw new Error("Design no longer exists.");
      if (!design.exportFileId) throw new Error("Export the design before publishing.");
      const deliveries: DeliveryResult[] = [];
      for (const platform of d.platforms) {
        const r = await publishSocial({ platform, caption: d.caption, mediaUrl: signedMediaUrl(design.exportFileId) });
        deliveries.push(r);
        await db.insert(schema.socialPosts).values({ platform, caption: d.caption, mediaFileId: design.exportFileId, status: "published", publishedAt: new Date(), externalId: r.providerId ?? null, sourceType: "design", sourceId: design.id });
      }
      await db.update(schema.designs).set({ status: "approved", updatedAt: new Date() }).where(eq(schema.designs.id, design.id));
      return { ok: true, simulated: deliveries.every((x) => x.simulated), deliveries };
    }
    default:
      throw new Error(`Unknown approval kind: ${a.kind}`);
  }
}

export async function campaignAudience(tags: string[], channel: string) {
  const db = await getDb();
  const all = await db.select().from(schema.contacts).where(eq(schema.contacts.doNotContact, false));
  return all.filter(
    (c) => (tags.length === 0 || tags.some((t) => c.tags.includes(t) || c.relationshipTypes.includes(t))) && (channel === "sms" ? !!c.phone : !!c.email),
  );
}

export function personalize(text: string, c: { firstName: string; lastName: string; email: string | null; phone: string | null }) {
  // Function replacers so "$&", "$1" etc. in a contact's name are inserted literally.
  return text
    .replace(/\{\{\s*first_?name\s*\}\}/gi, () => c.firstName || "friend")
    .replace(/\{\{\s*last_?name\s*\}\}/gi, () => c.lastName || "")
    .replace(/\{\{\s*name\s*\}\}/gi, () => contactName(c));
}
