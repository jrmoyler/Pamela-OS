"use client";

import { useOptimistic, useTransition, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type KanbanCard = { id: string; columnKey: string; position: number; title: string; subtitle?: string; badge?: string; tone?: "red" | "amber" | "default"; href?: string };

/** Generic drag-and-drop board used by Work boards and Pipelines. */
export function Kanban({
  columns,
  cards,
  onMove,
  footers,
}: {
  columns: { key: string; name: string; hint?: string }[];
  cards: KanbanCard[];
  onMove: (cardId: string, columnKey: string, position: number) => Promise<void>;
  footers?: Record<string, React.ReactNode>;
}) {
  const [optimistic, move] = useOptimistic(cards, (state, m: { id: string; columnKey: string; position: number }) =>
    state.map((c) => (c.id === m.id ? { ...c, columnKey: m.columnKey, position: m.position } : c)),
  );
  const [, start] = useTransition();
  const [over, setOver] = useState<string | null>(null);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => {
        const list = optimistic.filter((c) => c.columnKey === col.key).sort((a, b) => a.position - b.position);
        return (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.key);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/card");
              if (!id) return;
              const position = (list.at(-1)?.position ?? 0) + 1;
              start(async () => {
                move({ id, columnKey: col.key, position });
                await onMove(id, col.key, position);
              });
            }}
            className={cn("flex w-72 shrink-0 flex-col rounded-xl bg-zinc-100/80 p-2", over === col.key && "ring-2 ring-brand")}
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <p className="text-sm font-semibold text-brand-ink">{col.name}</p>
              <span className="text-xs text-zinc-500">{list.length}{col.hint ? ` · ${col.hint}` : ""}</span>
            </div>
            <div className="min-h-16 flex-1 space-y-2">
              {list.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/card", c.id)}
                  className="cursor-grab rounded-lg border border-zinc-200 bg-white p-3 shadow-sm active:cursor-grabbing"
                >
                  {c.href ? (
                    <Link href={c.href} className="text-sm font-medium hover:text-brand">{c.title}</Link>
                  ) : (
                    <p className="text-sm font-medium">{c.title}</p>
                  )}
                  {c.subtitle && <p className="mt-0.5 text-xs text-zinc-500">{c.subtitle}</p>}
                  {c.badge && (
                    <span className={cn("mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium", c.tone === "red" ? "bg-red-50 text-red-700" : c.tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-brand-soft text-brand")}>{c.badge}</span>
                  )}
                  <select
                    aria-label="Move to column"
                    value={c.columnKey}
                    onChange={(e) => {
                      const key = e.target.value;
                      start(async () => {
                        move({ id: c.id, columnKey: key, position: 999 });
                        await onMove(c.id, key, 999);
                      });
                    }}
                    className="mt-2 w-full rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5 text-[11px] text-zinc-500 lg:hidden"
                  >
                    {columns.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {footers?.[col.key]}
          </div>
        );
      })}
    </div>
  );
}
