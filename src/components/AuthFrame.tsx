import { Coffee } from "lucide-react";

export function AuthFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-brand px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-brand text-white">
            <Coffee className="h-6 w-6" />
          </span>
          <p className="font-serif text-sm text-brand">A Cup of Compassion</p>
          <h1 className="mt-1 text-xl font-bold text-brand-ink">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}
