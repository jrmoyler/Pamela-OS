"use server";

import { revalidatePath } from "next/cache";
import { getSetting, setSetting } from "@/lib/settings";
import { normalizePhone } from "@/lib/crm";
import { startCall, handleTurn, finalizeCall, type CallState, type TurnResult } from "@/lib/modules/receptionist";

export async function saveReceptionistSettings(form: FormData) {
  const cur = await getSetting("receptionist");
  await setSetting("receptionist", {
    greeting: String(form.get("greeting") || cur.greeting),
    urgentKeywords: String(form.get("urgentKeywords") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    transferNumber: normalizePhone(String(form.get("transferNumber") || "")) || cur.transferNumber,
    enabled: form.get("enabled") === "on",
  });
  revalidatePath("/receptionist");
}

export async function testStart(from: string): Promise<TurnResult> {
  return startCall({ callSid: `TEST-${crypto.randomUUID()}`, from: from || null, to: "+13239432287" });
}

export async function testTurn(callId: string, utterance: string, state: CallState): Promise<TurnResult> {
  const r = await handleTurn(callId, utterance, state);
  if (r.action.type !== "continue") revalidatePath("/receptionist");
  return r;
}

export async function testEnd(callId: string) {
  await finalizeCall(callId);
  revalidatePath("/receptionist");
}
