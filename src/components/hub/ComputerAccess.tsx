import Link from "next/link";
import { isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { CLIENT_LABELS, hasScope, type AgentClient } from "@/lib/hub/keys";
import { KIND_LABELS } from "@/lib/hub/computer";
import { COMPUTER_KINDS, COMPUTER_POLICIES, keyAccess, POLICY_LABELS, rjAccess, type Access } from "@/lib/hub/access";
import { Card, CardHeader, Badge, Button, Select } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { endTrust, saveAccess, trustAgent } from "@/app/(app)/hub/actions";

type Row = { who: string; name: string; client: string; access: Access };

/** Per-connector computer access: RJ plus every agent key that has the computer permission. */
export async function ComputerAccess() {
  const db = await getDb();
  const [keys, rj, tz] = await Promise.all([db.select().from(schema.agentKeys).where(isNull(schema.agentKeys.revokedAt)), rjAccess(), getSetting("timezone")]);
  const rows: Row[] = [
    { who: "rj", name: "RJ", client: "Your operator in Pamela OS", access: rj },
    ...keys.filter((k) => hasScope(k, "computer")).map((k) => ({ who: k.id, name: k.name, client: CLIENT_LABELS[k.client as AgentClient] ?? k.client, access: keyAccess(k) })),
  ];
  const now = new Date();

  return (
    <Card id="access">
      <CardHeader
        title="Computer access"
        subtitle="Decide, per connector, whether its requests to use your computer wait for your yes. Hermes still asks before signing in, submitting, installing or deleting."
      />
      <ul className="divide-y divide-zinc-100">
        {rows.map((r) => {
          const trusted = r.access.policy === "ask" && r.access.trustUntil && r.access.trustUntil > now;
          return (
            <li key={r.who} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-brand-ink">{r.name}</span>
                {r.client !== r.name && <span className="text-xs text-zinc-400">{r.client}</span>}
                <Badge className="ml-auto" tone={r.access.policy === "block" ? "red" : r.access.policy === "allow" ? "green" : trusted ? "blue" : "amber"}>
                  {trusted ? `trusted until ${fmtDate(r.access.trustUntil!, tz)}` : POLICY_LABELS[r.access.policy]}
                </Badge>
              </div>
              <form action={saveAccess.bind(null, r.who)} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Select name="policy" defaultValue={r.access.policy} className="h-8 w-auto py-0" aria-label={`Computer access for ${r.name}`}>
                  {COMPUTER_POLICIES.map((p) => <option key={p} value={p}>{POLICY_LABELS[p]}</option>)}
                </Select>
                {COMPUTER_KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-1 text-xs text-zinc-600">
                    <input type="checkbox" name="kinds" value={k} defaultChecked={r.access.kinds.includes(k)} className="accent-brand" /> {KIND_LABELS[k]}
                  </label>
                ))}
                <Button size="sm" variant="outline">Save</Button>
              </form>
              {r.access.policy === "ask" && (
                <form className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="text-zinc-500">Trust for a while:</span>
                  <Button size="sm" variant="ghost" formAction={trustAgent.bind(null, r.who, "1h")}>1 hour</Button>
                  <Button size="sm" variant="ghost" formAction={trustAgent.bind(null, r.who, "4h")}>4 hours</Button>
                  <Button size="sm" variant="ghost" formAction={trustAgent.bind(null, r.who, "today")}>Rest of today</Button>
                  {trusted && <Button size="sm" variant="ghost" className="text-red-600" formAction={endTrust.bind(null, r.who)}>End now</Button>}
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length === 1 && (
        <p className="border-t border-zinc-100 p-4 text-xs text-zinc-500">
          Only RJ can ask right now. To let Claude, ChatGPT, Meta Muse or Hermes ask, give its key the computer permission in <Link href="/hub/connect" className="text-brand underline">Connect agents</Link>.
        </p>
      )}
    </Card>
  );
}
