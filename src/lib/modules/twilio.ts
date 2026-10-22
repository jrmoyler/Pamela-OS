import crypto from "node:crypto";
import { getSecret } from "../settings";

/** Parses a Twilio webhook and validates X-Twilio-Signature when an auth token is configured. */
export async function readTwilio(req: Request): Promise<{ ok: boolean; params: Record<string, string> }> {
  const text = await req.text();
  const params = Object.fromEntries(new URLSearchParams(text));
  const token = await getSecret("TWILIO_AUTH_TOKEN");
  if (!token) return { ok: true, params };
  const sig = req.headers.get("x-twilio-signature") ?? "";
  const reqUrl = new URL(req.url);
  // Behind proxies the public URL differs from req.url; APP_URL is the source of truth.
  const base = process.env.APP_URL?.replace(/\/$/, "");
  const candidates = [req.url, base ? base + reqUrl.pathname + reqUrl.search : null].filter(Boolean) as string[];
  const ok = candidates.some((url) => {
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
    const expected = crypto.createHmac("sha1", token).update(data).digest("base64");
    return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  });
  return { ok, params };
}

export const twiml = (xml: string, status = 200) => new Response(xml, { status, headers: { "content-type": "text/xml; charset=utf-8" } });
export const forbidden = () => twiml(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>`, 403);
