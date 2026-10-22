import { readTwilio, twiml, forbidden } from "@/lib/modules/twilio";
import { handleInboundSms } from "@/lib/modules/sms";

/** Inbound texts to (323) 943-ACUP: logged, then RJ drafts a reply for approval. */
export async function POST(req: Request) {
  const { ok, params } = await readTwilio(req);
  if (!ok) return forbidden();
  await handleInboundSms({ from: params.From, to: params.To, body: params.Body ?? "", mediaUrls: Object.keys(params).filter((k) => k.startsWith("MediaUrl")).map((k) => params[k]) });
  return twiml(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
}
