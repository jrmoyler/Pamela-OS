import { Coffee, Phone } from "lucide-react";
import { BRAND } from "@/lib/brand";

export default function PublicBookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-brand-soft/40">
      <header className="bg-brand text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <span className="flex items-center gap-2 font-serif text-lg">
            <Coffee className="h-5 w-5" /> {BRAND.name}
          </span>
          <span className="flex items-center gap-1.5 text-sm"><Phone className="h-4 w-4" /> {BRAND.phoneDisplay}</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10">{children}</main>
      <footer className="pb-10 text-center text-xs text-zinc-500">© {new Date().getFullYear()} {BRAND.name} · {BRAND.phoneDisplay}</footer>
    </div>
  );
}
