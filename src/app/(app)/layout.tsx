import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { LogOut, Search, FlaskConical } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { Sidebar } from "@/components/shell/Sidebar";
import { Dictation } from "@/components/shell/Dictation";
import { PwaInstall, Heartbeat } from "@/components/shell/Pwa";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const db = await getDb();
  const [{ value: pending }] = await db.select({ value: count() }).from(schema.approvals).where(eq(schema.approvals.status, "pending"));
  const mode = await getSetting("deliveryMode");

  return (
    <div className="min-h-screen">
      <Sidebar pendingApprovals={Number(pending)} />
      <div className="lg:pl-60">
        {/* Visible on phones too: search, install, sandbox notice and sign-out live only here. */}
        <header className="z-20 flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-2.5 backdrop-blur lg:sticky lg:top-0 lg:px-6">
          <form action="/contacts" className="relative min-w-0 max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input name="q" aria-label="Find a person" placeholder="Find a person…" className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-3 text-sm focus:border-brand focus:bg-white focus:outline-none" />
          </form>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {mode === "sandbox" && (
              <Link href="/settings#delivery" className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700" title="Approved items are recorded but not delivered. Switch to Live in Settings." aria-label="Sandbox delivery">
                <FlaskConical className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sandbox delivery</span>
              </Link>
            )}
            <PwaInstall />
            <span className="hidden text-sm text-zinc-500 sm:inline">{session.name}</span>
            <form action="/api/auth/logout" method="post">
              <button title="Sign out" aria-label="Sign out" className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-brand-soft hover:text-brand">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 pb-28 lg:px-8">{children}</main>
      </div>
      <Dictation />
      <Heartbeat />
    </div>
  );
}
