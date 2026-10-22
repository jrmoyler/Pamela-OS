import { findOrCreateContact, logActivity, contactName } from "../crm";
import { emit } from "../events";
import { createApproval } from "../approvals";
import { draftInHerVoice } from "../rj/voice";
import { getSetting } from "../settings";
import { getDb, schema } from "../db";

const STOP = /^\s*(stop|unsubscribe|cancel|end|quit)\s*$/i;

export async function handleInboundSms(p: { from: string; to?: string; body: string; mediaUrls?: string[] }) {
  const { contact, created } = await findOrCreateContact({ phone: p.from, source: "sms" });
  if (created) await emit("contact.created", { contactId: contact.id, source: "sms" }, "sms");
  await logActivity({ type: "sms", direction: "inbound", contactId: contact.id, title: "Text received", body: p.body, meta: { from: p.from, media: p.mediaUrls ?? [] } });
  await emit("sms.received", { contactId: contact.id, from: p.from, body: p.body }, "sms");

  if (STOP.test(p.body)) {
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    await db.update(schema.contacts).set({ doNotContact: true }).where(eq(schema.contacts.id, contact.id));
    return { contact, approval: null };
  }

  const settings = await getSetting("receptionist");
  const urgent = settings.urgentKeywords.some((k) => k && p.body.toLowerCase().includes(k.toLowerCase()));
  if (urgent) {
    const db = await getDb();
    await db.insert(schema.tasks).values({ title: `Urgent text from ${contactName(contact)}: ${p.body.slice(0, 120)}`, priority: "urgent", dueAt: new Date(), contactId: contact.id, source: "receptionist" });
  }
  const draft = await draftInHerVoice({
    channel: "sms",
    instructions: `Reply to this text you received: "${p.body}". Be helpful and brief; if they want to meet, point them to booking a time.`,
    contact,
  });
  const approval = await createApproval({
    kind: "sms",
    title: `Reply to ${contactName(contact)}'s text`,
    summary: `They wrote: “${p.body.slice(0, 200)}”`,
    payload: { to: contact.phone ?? p.from, body: draft.body },
    contactId: contact.id,
    createdBy: "receptionist",
  });
  return { contact, approval };
}
