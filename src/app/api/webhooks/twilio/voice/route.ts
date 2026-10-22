import { readTwilio, twiml, forbidden } from "@/lib/modules/twilio";
import { startCall, twimlFor } from "@/lib/modules/receptionist";

/** Twilio "A call comes in" webhook for (323) 943-ACUP. */
export async function POST(req: Request) {
  const { ok, params } = await readTwilio(req);
  if (!ok) return forbidden();
  const r = await startCall({ callSid: params.CallSid, from: params.From, to: params.To });
  return twiml(twimlFor(r));
}
