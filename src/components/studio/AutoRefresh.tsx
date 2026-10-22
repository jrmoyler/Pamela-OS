"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Polls the server while a job is running; nudges the scheduler so inline jobs progress. */
export function AutoRefresh({ every = 4000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      fetch("/api/cron/tick", { method: "POST" }).catch(() => {});
      router.refresh();
    }, every);
    return () => clearInterval(id);
  }, [router, every]);
  return null;
}
