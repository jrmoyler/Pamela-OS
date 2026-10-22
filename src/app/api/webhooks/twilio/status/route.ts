import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { readTwilio, forbidden } from "@/lib/modules/twilio";
import { finalizeCall } from "@/lib/modules/receptionist";

/** Call status callback — finalises the call log when the caller hangs up. */
export async function POST(req: Request) {
  const { ok, params } = await readTwilio(req);
  if (!ok) return forbidden();
  if (["completed", "busy", "failed", "no-answer", "canceled"].includes(params.CallStatus)) {
    const db = await getDb();
    const [call] = params.CallSid ? await db.select().from(schema.calls).where(eq(schema.calls.callSid, params.CallSid)) : [];
    if (call) await finalizeCall(call.id);
  }
  return new Response(null, { status: 204 });
}
