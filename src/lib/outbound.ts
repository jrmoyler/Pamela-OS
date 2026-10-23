import { getSecret, getSetting } from "./settings";
import { hmacHex, safeEqual } from "./crypto";
import { authSecret } from "./session";

/**
 * Low-level delivery adapters. NOTHING outside `approvals.ts` may import these:
 * every outbound action must pass through the approval gate first.
 *
 * In "sandbox" delivery mode (default until Pamela flips it in Settings) the
 * adapters record what *would* have been sent and return `simulated: true`.
 */
export type DeliveryResult = { ok: true; simulated: boolean; providerId?: string; detail?: string; url?: string };

export class NotConnectedError extends Error {
  constructor(service: string) {
    super(`${service} is not connected. Add the keys in Settings → Connections, or switch delivery to Sandbox.`);
  }
}

async function live() {
  return (await getSetting("deliveryMode")) === "live";
}

const LOCAL_URL = /^(https?:\/\/)?(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

/** True for addresses only this machine can reach — Claude, Twilio, Meta and Stripe can never call them. */
export function isLocalUrl(url: string) {
  return LOCAL_URL.test(url.trim());
}

function cleanBase(url: string) {
  const u = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/**
 * Public base URL for links that outside services and agents follow (MCP connector URLs, webhooks,
 * payment and media links). APP_URL wins; on Vercel without it (or with a leftover localhost value)
 * we use the project's production domain, so links never point at localhost on a deployed app.
 */
export function appUrl() {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  const deployed = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (configured && !(deployed && isLocalUrl(configured))) return cleanBase(configured);
  if (deployed) return cleanBase(deployed);
  return configured ? cleanBase(configured) : "http://localhost:3000";
}

/**
 * appUrl() for code running inside a page or server action: when no public address is configured
 * (e.g. a VPS without APP_URL), use the address the browser actually reached instead of localhost.
 */
export async function requestAppUrl() {
  const base = appUrl();
  if (!isLocalUrl(base)) return base;
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host && !isLocalUrl(host)) return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  } catch {
    // Outside a request (worker, scripts): fall through.
  }
  return base;
}

/** Signed, expiring public URL for a stored file (needed for MMS / Instagram media fetches). */
export function signedMediaUrl(fileId: string, ttlSec = 7 * 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = hmacHex(authSecret(), `${fileId}.${exp}`);
  return `${appUrl()}/api/public/media/${fileId}?exp=${exp}&sig=${sig}`;
}

export function verifyMediaSig(fileId: string, exp: string, sig: string) {
  // Reject non-numeric expiries outright (NaN < now is false, so it never "expired").
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(hmacHex(authSecret(), `${fileId}.${exp}`), sig);
}

/* ───────────── Email (Resend) ───────────── */

export async function sendEmail(p: { to: string; subject: string; body: string; replyTo?: string }): Promise<DeliveryResult> {
  if (!(await live())) return { ok: true, simulated: true, detail: `Email to ${p.to}` };
  const key = await getSecret("RESEND_API_KEY");
  if (!key) throw new NotConnectedError("Email (Resend)");
  const from = await getSetting("emailFrom");
  const html = p.body
    .split(/\n{2,}/)
    .map((para) => `<p style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#1f1530">${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `${from.name} <${from.address}>`,
      to: [p.to],
      subject: p.subject,
      text: p.body,
      html: `<div style="border-top:6px solid #6a1b9a;padding:24px">${html}</div>`,
      reply_to: p.replyTo,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { ok: true, simulated: false, providerId: data.id };
}

/* ───────────── SMS / MMS / calls (Twilio) ───────────── */

async function twilio() {
  const sid = await getSecret("TWILIO_ACCOUNT_SID");
  const token = await getSecret("TWILIO_AUTH_TOKEN");
  const from = await getSecret("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) throw new NotConnectedError("Twilio");
  return { sid, token, from, auth: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") };
}

export async function sendSms(p: { to: string; body: string; mediaUrl?: string }): Promise<DeliveryResult> {
  if (!(await live())) return { ok: true, simulated: true, detail: `Text to ${p.to}` };
  const t = await twilio();
  const form = new URLSearchParams({ To: p.to, From: t.from, Body: p.body });
  if (p.mediaUrl) form.append("MediaUrl", p.mediaUrl);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: t.auth, "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { ok: true, simulated: false, providerId: data.sid };
}

/** Places an outbound call that plays an approved audio file (voice drop). */
export async function placeVoiceDrop(p: { to: string; audioUrl: string }): Promise<DeliveryResult> {
  if (!(await live())) return { ok: true, simulated: true, detail: `Voice drop to ${p.to}` };
  const t = await twilio();
  const twiml = `<Response><Play>${escapeHtml(p.audioUrl)}</Play></Response>`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.sid}/Calls.json`, {
    method: "POST",
    headers: { authorization: t.auth, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: p.to, From: t.from, Twiml: twiml }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
  return { ok: true, simulated: false, providerId: (await res.json()).sid };
}

/* ───────────── Meta Graph (Instagram / Facebook) ───────────── */

const GRAPH = "https://graph.facebook.com/v21.0";

export async function sendDm(p: { recipientId: string; message: string; platform: "instagram" | "facebook"; commentId?: string }): Promise<DeliveryResult> {
  if (!(await live())) return { ok: true, simulated: true, detail: `${p.platform} DM to ${p.recipientId}` };
  const token = await getSecret("META_PAGE_ACCESS_TOKEN");
  const pageId = await getSecret("META_PAGE_ID");
  if (!token || !pageId) throw new NotConnectedError("Meta (Facebook/Instagram)");
  // Private replies to a comment use comment_id as the recipient.
  const recipient = p.commentId ? { comment_id: p.commentId } : { id: p.recipientId };
  const res = await fetch(`${GRAPH}/${pageId}/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient, message: { text: p.message }, messaging_type: "RESPONSE" }),
  });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
  return { ok: true, simulated: false, providerId: (await res.json()).message_id };
}

export async function publishSocial(p: { platform: "instagram" | "facebook"; caption: string; mediaUrl?: string; isVideo?: boolean }): Promise<DeliveryResult> {
  if (!(await live())) return { ok: true, simulated: true, detail: `${p.platform} post` };
  const token = await getSecret("META_PAGE_ACCESS_TOKEN");
  if (!token) throw new NotConnectedError("Meta (Facebook/Instagram)");
  if (p.platform === "facebook") {
    const pageId = await getSecret("META_PAGE_ID");
    if (!pageId) throw new NotConnectedError("Facebook page");
    const endpoint = p.mediaUrl ? (p.isVideo ? "videos" : "photos") : "feed";
    const body: Record<string, string> = { access_token: token };
    if (p.mediaUrl) {
      body[p.isVideo ? "file_url" : "url"] = p.mediaUrl;
      body[p.isVideo ? "description" : "caption"] = p.caption;
    } else body.message = p.caption;
    const res = await fetch(`${GRAPH}/${pageId}/${endpoint}`, { method: "POST", body: new URLSearchParams(body) });
    if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { ok: true, simulated: false, providerId: data.post_id ?? data.id };
  }
  const igId = await getSecret("META_IG_USER_ID");
  if (!igId) throw new NotConnectedError("Instagram business account");
  if (!p.mediaUrl) throw new Error("Instagram posts need an image or video.");
  const create = await fetch(`${GRAPH}/${igId}/media`, {
    method: "POST",
    body: new URLSearchParams({
      access_token: token,
      caption: p.caption,
      ...(p.isVideo ? { media_type: "REELS", video_url: p.mediaUrl } : { image_url: p.mediaUrl }),
    }),
  });
  if (!create.ok) throw new Error(`Graph ${create.status}: ${await create.text()}`);
  const { id: creationId } = await create.json();
  // Video containers process asynchronously; poll briefly.
  for (let i = 0; p.isVideo && i < 30; i++) {
    const st = await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`).then((r) => r.json());
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR") throw new Error("Instagram could not process the video.");
    await new Promise((r) => setTimeout(r, 5000));
  }
  const pub = await fetch(`${GRAPH}/${igId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ access_token: token, creation_id: creationId }),
  });
  if (!pub.ok) throw new Error(`Graph ${pub.status}: ${await pub.text()}`);
  return { ok: true, simulated: false, providerId: (await pub.json()).id };
}

/* ───────────── Stripe ───────────── */

export async function stripeRequest(path: string, params: Record<string, string>, method = "POST") {
  const key = await getSecret("STRIPE_SECRET_KEY");
  if (!key) throw new NotConnectedError("Stripe");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : new URLSearchParams(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data.error?.message ?? "error"}`);
  return data;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
