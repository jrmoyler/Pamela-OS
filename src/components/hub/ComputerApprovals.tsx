import Link from "next/link";
import { MonitorSmartphone, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { getSetting } from "@/lib/settings";
import { KIND_LABELS, type ComputerKind } from "@/lib/hub/computer";
import { looksOutbound, pendingComputerApprovals, PERMISSION_CATEGORIES, type PermissionCategory } from "@/lib/hub/access";
import { Card, CardHeader, Badge, Button, Input } from "@/components/ui";
import { fmtDate, timeAgo } from "@/lib/utils";
import { answerStep, approveTask, denyTask } from "@/app/(app)/hub/actions";

/**
 * Every request to use Pamela's computer that is waiting on her: tasks an agent
 * wants to start, and steps Hermes paused on mid-task. Shown on Approvals and
 * in the Command Center so she can answer from either place.
 */
export async function ComputerApprovals({ emptyText }: { emptyText?: string }) {
  const [{ tasks, permissions }, tz] = await Promise.all([pendingComputerApprovals(), getSetting("timezone")]);
  if (!tasks.length && !permissions.length) {
    return emptyText ? <p className="text-sm text-zinc-500">{emptyText}</p> : null;
  }

  return (
    <Card id="computer-use" className="overflow-hidden border-amber-200">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 text-brand" /> Computer use · {tasks.length + permissions.length} waiting
          </span>
        }
        subtitle="Hermes works on your computer and browser. Nothing here starts until you say yes."
        action={<Link href="/hub#access" className="text-xs text-brand underline">Who can ask</Link>}
      />
      <ul className="divide-y divide-zinc-100">
        {permissions.map((p) => {
          const warn = looksOutbound(`${p.action} ${p.detail ?? ""}`);
          return (
            <li key={p.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="amber">step in a task</Badge>
                <Badge>{PERMISSION_CATEGORIES[p.category as PermissionCategory] ?? p.category}</Badge>
                <span className="text-xs text-zinc-500">{p.who} · {timeAgo(p.createdAt)}</span>
                {p.expiresAt && <span className="ml-auto text-xs text-zinc-400">lapses {fmtDate(p.expiresAt, tz)}</span>}
              </div>
              <p className="font-medium text-brand-ink">{p.action}</p>
              {p.detail && <p className="whitespace-pre-wrap text-sm text-zinc-600">{p.detail}</p>}
              {p.url && <p className="break-all text-xs text-zinc-500">On {p.url}</p>}
              {p.task && <p className="text-xs text-zinc-500">Part of: “{p.task.instruction.slice(0, 160)}”</p>}
              {warn && (
                <p className="flex items-start gap-1 rounded-md bg-red-50 p-2 text-xs text-red-700">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  This looks like it reaches another person or moves money. Hermes isn&apos;t meant to do that; send or pay from Pamela OS instead.
                </p>
              )}
              <form className="flex flex-wrap items-center gap-2">
                <Input name="note" placeholder="Note for Hermes (optional)" className="h-8 min-w-0 flex-1 basis-48" aria-label="Note for Hermes" />
                <Button size="sm" formAction={answerStep.bind(null, p.id, true)}><ShieldCheck className="h-3.5 w-3.5" /> Allow this step</Button>
                <Button size="sm" variant="ghost" className="text-red-600" formAction={answerStep.bind(null, p.id, false)}><X className="h-3.5 w-3.5" /> Deny</Button>
              </form>
            </li>
          );
        })}
        {tasks.map((t) => (
          <li key={t.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="amber">new task</Badge>
              <Badge>{KIND_LABELS[t.kind as ComputerKind] ?? t.kind}</Badge>
              <span className="text-xs text-zinc-500">from {t.who} · {timeAgo(t.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-brand-ink">{t.instruction}</p>
            <form className="flex flex-wrap items-center gap-2">
              <Button size="sm" formAction={approveTask.bind(null, t.id, undefined)}><ShieldCheck className="h-3.5 w-3.5" /> Approve</Button>
              <Button size="sm" variant="outline" formAction={approveTask.bind(null, t.id, "1h")} title={`Approve, and let ${t.who} start computer tasks without asking for the next hour`}>
                Approve + trust 1 hour
              </Button>
              <Button size="sm" variant="outline" formAction={approveTask.bind(null, t.id, "today")} title={`Approve, and let ${t.who} start computer tasks without asking until midnight`}>
                + trust today
              </Button>
              <Input name="note" placeholder="Why not? (optional)" className="h-8 min-w-0 flex-1 basis-40" aria-label="Reason for denying" />
              <Button size="sm" variant="ghost" className="text-red-600" formAction={denyTask.bind(null, t.id)}><X className="h-3.5 w-3.5" /> Deny</Button>
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}
