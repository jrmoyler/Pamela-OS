import { getDb, schema } from "../db";

/** Creates a pending payment. The customer pays on the in-app /pay/[id] page. */
export async function createPaymentRequest(p: { contactId: string | null; amountCents: number; description: string }) {
  const db = await getDb();
  const [payment] = await db
    .insert(schema.payments)
    .values({ contactId: p.contactId, amountCents: p.amountCents, description: p.description })
    .returning();
  return payment;
}
