"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Registers the service worker and offers an "Install Pamela OS" button. */
export function PwaInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  if (!prompt) return null;
  return (
    <button
      onClick={async () => {
        await prompt.prompt();
        setPrompt(null);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-white px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-soft"
    >
      <Download className="h-3.5 w-3.5" /> Install app
    </button>
  );
}

/**
 * While the app is open it nudges the scheduler once a minute, so sequences,
 * scheduled sends and queued jobs run even without an external cron.
 */
export function Heartbeat() {
  useEffect(() => {
    const ping = () => fetch("/api/cron/tick", { method: "POST" }).catch(() => {});
    const first = setTimeout(ping, 5000);
    const id = setInterval(ping, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return null;
}
