"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type Health = { ok: boolean; db: { ok: boolean; title?: string; fix?: string; config?: boolean } };

/** Asks /api/health why things failed. Resolves to null while loading or if the probe itself is unreachable. */
export function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json() as Promise<Health>)
      .then((h) => alive && setHealth(h))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return health;
}

/**
 * Full-page fallback for server errors outside the app shell (login, setup, the shell itself).
 * Instead of Next's bare "Application error" screen, it explains what's wrong in plain words and,
 * when the database is the problem, exactly which setting to fix.
 */
export function ServiceProblem({ digest, reset }: { digest?: string; reset?: () => void }) {
  const health = useHealth();
  const db = health && !health.db.ok ? health.db : null;
  const title = db?.title ?? "Pamela OS hit a problem loading this page";
  const body = db?.fix ?? "This is usually temporary. Try again in a moment.";

  const retry = () => {
    if (reset) reset();
    window.location.reload();
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#6a1b9a] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-600" />
        <p className="mt-3 font-serif text-sm text-[#6a1b9a]">A Cup of Compassion</p>
        <h1 className="mt-1 text-xl font-bold text-zinc-900">{title}</h1>
        <p className="mt-3 text-left text-sm leading-relaxed text-zinc-700">{body}</p>
        {db?.config && (
          <p className="mt-3 text-left text-xs text-zinc-500">
            Your data is safe. This is a settings problem, and nothing was lost.
          </p>
        )}
        <button
          onClick={retry}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#6a1b9a] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
        {digest && <p className="mt-4 text-[11px] text-zinc-400">Reference: {digest}</p>}
      </div>
    </main>
  );
}
