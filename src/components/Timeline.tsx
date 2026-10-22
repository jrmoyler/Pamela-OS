import { Phone, MessageSquare, Mail, Mic, StickyNote, ShoppingBag, FileText, CalendarCheck, Send, CheckSquare, Workflow, Voicemail, Share2, Info } from "lucide-react";
import { fmtDate } from "@/lib/utils";
import { Badge } from "./ui";

type Activity = {
  id: string;
  type: string;
  direction: string;
  title: string;
  body: string | null;
  occurredAt: Date;
};

const ICONS: Record<string, typeof Phone> = {
  call: Phone,
  sms: MessageSquare,
  email: Mail,
  meeting: Mic,
  note: StickyNote,
  purchase: ShoppingBag,
  form: FileText,
  booking: CalendarCheck,
  dm: Send,
  task: CheckSquare,
  automation: Workflow,
  voicemail: Voicemail,
  social: Share2,
  system: Info,
};

export function Timeline({ items, tz }: { items: Activity[]; tz: string }) {
  if (!items.length) return <p className="px-4 py-6 text-sm text-zinc-500">No activity yet.</p>;
  return (
    <ol className="relative space-y-4 px-4 py-4">
      {items.map((a) => {
        const Icon = ICONS[a.type] ?? Info;
        return (
          <li key={a.id} className="flex gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-brand-ink">{a.title}</p>
                {a.direction !== "internal" && <Badge tone={a.direction === "inbound" ? "blue" : "brand"}>{a.direction}</Badge>}
                <span className="text-xs text-zinc-400">{fmtDate(a.occurredAt, tz)}</span>
              </div>
              {a.body && <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600">{a.body.length > 1200 ? a.body.slice(0, 1200) + "…" : a.body}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
