import Link from "next/link";
import { desc, ilike, or, sql, type SQL } from "drizzle-orm";
import { Users, Plus } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { contactName, RELATIONSHIP_TYPES } from "@/lib/crm";
import { PageHeader, Card, Badge, EmptyState, Input, Button, Field } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { createContact } from "./actions";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; rel?: string; tag?: string; new?: string }> }) {
  const { q, rel, tag, new: showNew } = await searchParams;
  const db = await getDb();
  const conds: SQL[] = [];
  if (q) {
    const like = `%${q}%`;
    conds.push(
      or(
        ilike(schema.contacts.firstName, like),
        ilike(schema.contacts.lastName, like),
        ilike(schema.contacts.email, like),
        ilike(schema.contacts.phone, like),
        ilike(schema.contacts.company, like),
        sql`(${schema.contacts.firstName} || ' ' || ${schema.contacts.lastName}) ilike ${like}`,
      )!,
    );
  }
  if (rel) conds.push(sql`${rel} = any(${schema.contacts.relationshipTypes})`);
  if (tag) conds.push(sql`${tag} = any(${schema.contacts.tags})`);
  const rows = await db
    .select()
    .from(schema.contacts)
    .where(conds.length ? sql.join(conds, sql` and `) : undefined)
    .orderBy(desc(sql`coalesce(${schema.contacts.lastActivityAt}, ${schema.contacts.createdAt})`))
    .limit(300);

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="One record per person — every call, text, email, meeting and purchase on one timeline."
        actions={
          <Link href="/contacts?new=1">
            <Button>
              <Plus className="h-4 w-4" /> New contact
            </Button>
          </Link>
        }
      />
      {showNew && (
        <Card className="mb-6 p-4">
          <form action={createContact} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="First name"><Input name="firstName" required /></Field>
            <Field label="Last name"><Input name="lastName" /></Field>
            <Field label="Company / org"><Input name="company" /></Field>
            <Field label="Email"><Input name="email" type="email" /></Field>
            <Field label="Phone"><Input name="phone" type="tel" /></Field>
            <Field label="Tags" hint="Comma separated"><Input name="tags" /></Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Relationship</p>
              <div className="flex flex-wrap gap-2">
                {RELATIONSHIP_TYPES.map((r) => (
                  <label key={r} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand">
                    <input type="checkbox" name="relationshipTypes" value={r} className="accent-brand" /> {r}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <Button>Save contact</Button>
              <Link href="/contacts"><Button type="button" variant="ghost">Cancel</Button></Link>
            </div>
          </form>
        </Card>
      )}
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} aria-label="Search contacts" placeholder="Search name, email, phone, org…" className="max-w-xs" />
        <select name="rel" aria-label="Relationship" defaultValue={rel ?? ""} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm">
          <option value="">All relationships</option>
          {RELATIONSHIP_TYPES.map((r) => <option key={r}>{r}</option>)}
        </select>
        <Button variant="outline">Filter</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8" />} title={q || rel ? "No matches" : "No contacts yet"}>
          People land here automatically from forms, bookings, calls, DMs and meetings — or add one yourself.
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="hidden px-4 py-2 md:table-cell">Reach</th>
                <th className="hidden px-4 py-2 lg:table-cell">Relationship</th>
                <th className="px-4 py-2 text-right">Last touch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-brand-soft/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/contacts/${c.id}`} className="font-medium text-brand-ink hover:text-brand">
                      {contactName(c)}
                    </Link>
                    {c.company && <p className="text-xs text-zinc-500">{c.company}</p>}
                  </td>
                  <td className="hidden px-4 py-2.5 text-zinc-600 md:table-cell">
                    <p>{c.email}</p>
                    <p className="text-xs">{c.phone}</p>
                  </td>
                  <td className="hidden px-4 py-2.5 lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {c.relationshipTypes.map((r) => <Badge key={r} tone="brand">{r}</Badge>)}
                      {c.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-zinc-500">{timeAgo(c.lastActivityAt ?? c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
