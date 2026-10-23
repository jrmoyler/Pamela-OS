import crypto from "node:crypto";
import { getSecret } from "../settings";
import { appUrl } from "../outbound";

/** Parses a Twilio webhook and validates X-Twilio-Signature when an auth token is configured. */
export async function readTwilio(req: Request): Promise<{ ok: boolean; params: Record<string, string> }> {
  const text = await req.text();
  const params = Object.fromEntries(new URLSearchParams(text));
  const token = await getSecret("TWILIO_AUTH_TOKEN");
  if (!token) return { ok: true, params };
  const sig = req.headers.get("x-twilio-signature") ?? "";
  const reqUrl = new URL(req.url);
  // Behind proxies the public URL differs from req.url, so also try the public base and the forwarded host.
  const host = req.headers.get("x-forwarded-host");
  const bases = [appUrl(), host ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}` : null];
  const candidates = [req.url, ...bases.filter(Boolean).map((b) => b + reqUrl.pathname + reqUrl.search)];
  const ok = candidates.some((url) => {
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
    const expected = crypto.createHmac("sha1", token).update(data).digest("base64");
    return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  });
  return { ok, params };
}

export const twiml = (xml: string, status = 200) => new Response(xml, { status, headers: { "content-type": "text/xml; charset=utf-8" } });
export const forbidden = () => twiml(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>`, 403);
