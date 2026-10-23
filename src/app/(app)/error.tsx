"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useHealth } from "@/components/ServiceProblem";

/**
 * Server actions throw for things like "Pick at least one platform." Without a
 * boundary those take down the whole app shell; this keeps the sidebar and
 * lets Pamela go back and try again.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Production redacts server error messages (only a digest is sent), so ask /api/health whether the
  // database is the cause before falling back to a friendly line.
  const health = useHealth();
  const db = health && !health.db.ok ? health.db : null;
  const message = db?.fix ?? (error.digest ? null : error.message);
  return (
    <Card className="mx-auto max-w-lg p-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
      <h1 className="mt-3 text-lg font-semibold text-brand-ink">{db?.title ?? "That didn\u2019t go through"}</h1>
      <p className="mt-1 text-sm text-zinc-600">{message || "Something went wrong. Check the details you entered and try again."}</p>
      <div className="mt-4 flex justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/">
          <Button variant="ghost">Back to Today</Button>
        </Link>
      </div>
    </Card>
  );
}
