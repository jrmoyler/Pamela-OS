import { eq, or, sql } from "drizzle-orm";
import { getDb, schema } from "./db";

export type Contact = typeof schema.contacts.$inferSelect;

export function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
}

export function contactName(c: Pick<Contact, "firstName" | "lastName" | "email" | "phone"> | null | undefined) {
  if (!c) return "Unknown";
  const n = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
  return n || c.email || c.phone || "Unknown";
}

export function splitName(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

export type ContactInput = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  source?: string | null;
  tags?: string[];
  relationshipTypes?: string[];
  socialHandles?: Record<string, string>;
};

/** One person, one record: matches on email, phone or social handle before creating. */
export async function findOrCreateContact(input: ContactInput): Promise<{ contact: Contact; created: boolean }> {
  const db = await getDb();
  const email = input.email?.trim().toLowerCase() || null;
  const phone = normalizePhone(input.phone);
  const conds = [];
  if (email) conds.push(eq(schema.contacts.email, email));
  if (phone) conds.push(eq(schema.contacts.phone, phone));
  for (const [k, v] of Object.entries(input.socialHandles ?? {})) {
    conds.push(sql`${schema.contacts.socialHandles} ->> ${k} = ${v}`);
  }
  const names = input.firstName || input.lastName ? { firstName: input.firstName ?? "", lastName: input.lastName ?? "" } : splitName(input.name);
  if (conds.length) {
    const [existing] = await db.select().from(schema.contacts).where(or(...conds)).limit(1);
    if (existing) {
      const tags = [...new Set([...existing.tags, ...(input.tags ?? [])])];
      const rel = [...new Set([...existing.relationshipTypes, ...(input.relationshipTypes ?? [])])];
      const [updated] = await db
        .update(schema.contacts)
        .set({
          tags,
          relationshipTypes: rel,
          email: existing.email ?? email,
          phone: existing.phone ?? phone,
          firstName: existing.firstName || names.firstName,
          lastName: existing.lastName || names.lastName,
          company: existing.company ?? input.company ?? null,
          socialHandles: { ...existing.socialHandles, ...(input.socialHandles ?? {}) },
          updatedAt: new Date(),
        })
        .where(eq(schema.contacts.id, existing.id))
        .returning();
      return { contact: updated, created: false };
    }
  }
  const [contact] = await db
    .insert(schema.contacts)
    .values({
      ...names,
      email,
      phone,
      company: input.company ?? null,
      source: input.source ?? null,
      tags: input.tags ?? [],
      relationshipTypes: input.relationshipTypes ?? [],
      socialHandles: input.socialHandles ?? {},
    })
    .returning();
  return { contact, created: true };
}

export type ActivityInput = {
  type: string;
  title: string;
  body?: string | null;
  direction?: "inbound" | "outbound" | "internal";
  contactId?: string | null;
  dealId?: string | null;
  subjectType?: string;
  subjectId?: string;
  meta?: Record<string, unknown>;
  occurredAt?: Date;
};

/** Writes to the contact timeline (and touches the contact's last-activity stamp). */
export async function logActivity(a: ActivityInput) {
  const db = await getDb();
  const [row] = await db
    .insert(schema.activities)
    .values({
      type: a.type,
      title: a.title,
      body: a.body ?? null,
      direction: a.direction ?? "internal",
      contactId: a.contactId ?? null,
      dealId: a.dealId ?? null,
      subjectType: a.subjectType ?? null,
      subjectId: a.subjectId ?? null,
      meta: a.meta ?? {},
      occurredAt: a.occurredAt ?? new Date(),
    })
    .returning();
  if (a.contactId) {
    await db.update(schema.contacts).set({ lastActivityAt: row.occurredAt }).where(eq(schema.contacts.id, a.contactId));
  }
  if (a.dealId) {
    await db.update(schema.deals).set({ updatedAt: new Date() }).where(eq(schema.deals.id, a.dealId));
  }
  return row;
}

export const RELATIONSHIP_TYPES = ["LegalShield", "Board", "Media", "School", "DR inquiry", "Client", "Speaking", "Partner", "Donor", "Family & friends"];
