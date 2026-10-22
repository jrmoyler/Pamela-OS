import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { Inbox } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { contactName } from "@/lib/crm";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";
import { SocialTabs } from "@/components/social/SocialTabs";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Social inbox" };

export default async function InboxPage() {
  const db = await getDb();
  const [rows, tz] = await Promise.all([
    db
      .select({ a: schema.activities, c: schema.contacts })
      .from(schema.activities)
      .leftJoin(schema.contacts, eq(schema.activities.contactId, schema.contacts.id))
      .where(inArray(schema.activities.type, ["social", "dm"]))
      .orderBy(desc(schema.activities.occurredAt))
      .limit(150),
    getSetting("timezone"),
  ]);
  return (
    <>
      <PageHeader title="Social & DMs" subtitle="Comments and messages from Instagram and Facebook, with what went back out." />
      <SocialTabs active="/social/inbox" />
      {rows.length === 0 ? (
        <EmptyState icon={<Inbox className="h-8 w-8" />} title="Nothing yet">
          Comments and DMs arrive here from the Meta webhook.
        </EmptyState>
      ) : (
        <Card className="divide-y divide-zinc-100">
          {rows.map(({ a, c }) => (
            <div key={a.id} className="flex gap-3 px-4 py-3">
              <Badge tone={a.direction === "inbound" ? "blue" : "brand"} className="h-fit">
                {a.direction === "inbound" ? "in" : "out"}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {c ? (
                    <Link href={`/contacts/${c.id}`} className="hover:text-brand">
                      {contactName(c)}
                    </Link>
                  ) : (
                    <span className="text-zinc-500">Unmatched</span>
                  )}{" "}
                  <span className="font-normal text-zinc-500">· {a.title}</span>
                </p>
                {a.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-700">{a.body}</p>}
              </div>
              <span className="whitespace-nowrap text-xs text-zinc-400">{fmtDate(a.occurredAt, tz)}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
