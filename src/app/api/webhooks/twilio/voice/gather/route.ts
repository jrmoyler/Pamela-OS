import { readTwilio, twiml, forbidden } from "@/lib/modules/twilio";
import { handleTurn, twimlFor, decodeState, startCall } from "@/lib/modules/receptionist";

/** Each spoken turn from the caller (Gather speech result). */
export async function POST(req: Request) {
  const { ok, params } = await readTwilio(req);
  if (!ok) return forbidden();
  const state = decodeState(new URL(req.url).searchParams.get("s"));
  if (!state) return twiml(twimlFor(await startCall({ callSid: params.CallSid, from: params.From, to: params.To })));
  const { callId, ...rest } = state;
  const r = await handleTurn(callId, params.SpeechResult ?? "", rest);
  return twiml(twimlFor(r));
}
