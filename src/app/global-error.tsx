"use client";

import "./globals.css";
import { ServiceProblem } from "@/components/ServiceProblem";

/** Last resort when even the root layout fails: never show Next's bare "Application error" screen. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <ServiceProblem digest={error.digest} reset={reset} />
      </body>
    </html>
  );
}
