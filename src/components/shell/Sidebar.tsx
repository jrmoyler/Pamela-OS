"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, Coffee } from "lucide-react";
import { NAV } from "./nav";
import { cn } from "@/lib/utils";

export function Sidebar({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));

  const body = (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
      <Link href="/" className="flex items-center gap-2 px-2" onClick={() => setOpen(false)}>
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-white text-brand">
          <Coffee className="h-5 w-5" />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-bold text-white">Pamela OS</span>
          <span className="block font-serif text-[11px] text-white/75">A Cup of Compassion</span>
        </span>
      </Link>
      {NAV.map((g) => (
        <div key={g.label}>
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/50">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium text-white/85 hover:bg-white/10 hover:text-white",
                      isActive(item.href) && "bg-white text-brand hover:bg-white hover:text-brand",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.href === "/approvals" && pendingApprovals > 0 && (
                      <span className={cn("rounded-full px-1.5 text-xs font-bold", isActive(item.href) ? "bg-brand text-white" : "bg-white text-brand")}>{pendingApprovals}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-brand lg:block">{body}</aside>
      <div className="sticky top-0 z-30 flex items-center justify-between bg-brand px-4 py-2 lg:hidden">
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="text-white">
          <Menu className="h-6 w-6" />
        </button>
        <span className="text-sm font-bold text-white">Pamela OS</span>
        <Link href="/approvals" className="rounded-full bg-white px-2 text-xs font-bold text-brand">
          {pendingApprovals}
        </Link>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-brand">
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-3 top-4 text-white">
              <X className="h-5 w-5" />
            </button>
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
