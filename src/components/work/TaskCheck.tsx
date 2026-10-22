"use client";

import { useTransition } from "react";
import { cn } from "@/lib/utils";

export function TaskCheck({ done, onToggle, label }: { done: boolean; onToggle: (done: boolean) => Promise<void>; label: string }) {
  const [pending, start] = useTransition();
  return (
    <input
      type="checkbox"
      aria-label={`Complete ${label}`}
      defaultChecked={done}
      disabled={pending}
      onChange={(e) => start(() => onToggle(e.target.checked))}
      className={cn("h-4 w-4 cursor-pointer accent-brand", pending && "opacity-50")}
    />
  );
}
