import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { readTwilio, twiml, forbidden } from "@/lib/modules/twilio";
import { decodeState, finalizeCall, twimlFor } from "@/lib/modules/receptionist";

/** After an urgent transfer: if Pamela didn't pick up, take a message instead. */
export async function POST(req: Request) {
  const { ok, params } = await readTwilio(req);
  if (!ok) return forbidden();
  const state = decodeState(new URL(req.url).searchParams.get("s"));
  if (!state) return twiml(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  const { callId, ...rest } = state;
  if (params.DialCallStatus === "completed" || params.DialCallStatus === "answered") {
    await finalizeCall(callId, { status: "transferred" });
    return twiml(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }
  const db = await getDb();
  const reply = "Pamela couldn't pick up just now. Please tell me your message and the best number to reach you, and I'll make sure she sees it right away.";
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
  if (call) {
    await db
      .update(schema.calls)
      .set({ status: "in_progress", disposition: "message", turns: [...call.turns, { role: "receptionist", text: reply, at: new Date().toISOString() }] })
      .where(eq(schema.calls.id, callId));
  }
  return twiml(twimlFor({ callId, reply, state: { ...rest, stage: "message" }, action: { type: "continue" } }));
}
