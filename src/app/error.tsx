"use client";

import { ServiceProblem } from "@/components/ServiceProblem";

/** Catches server errors on login, setup, public pages and the app shell's own layout. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ServiceProblem digest={error.digest} reset={reset} />;
}
