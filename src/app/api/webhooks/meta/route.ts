import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSecret } from "@/lib/settings";
import { handleMetaWebhook } from "@/lib/modules/social";

/** Meta subscription handshake. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = await getSecret("META_VERIFY_TOKEN");
  if (url.searchParams.get("hub.mode") === "subscribe" && token && url.searchParams.get("hub.verify_token") === token) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Instagram / Facebook comments and DMs. */
export async function POST(req: Request) {
  const raw = await req.text();
  const appSecret = await getSecret("META_APP_SECRET");
  if (appSecret) {
    const header = req.headers.get("x-hub-signature-256") ?? "";
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
    if (header.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
      return new Response("bad signature", { status: 401 });
    }
  }
  try {
    await handleMetaWebhook(JSON.parse(raw));
  } catch (e) {
    console.error("[meta webhook]", e);
  }
  // Always 200 so Meta doesn't disable the subscription; failures are logged.
  return NextResponse.json({ ok: true });
}
