import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-brand text-white hover:bg-brand-dark",
        outline: "border border-brand/30 bg-white text-brand hover:bg-brand-soft",
        ghost: "text-brand-ink hover:bg-brand-soft",
        danger: "bg-red-600 text-white hover:bg-red-700",
        soft: "bg-brand-soft text-brand hover:bg-brand/15",
      },
      size: { sm: "h-8 px-3", md: "h-10 px-4", lg: "h-12 px-6 text-base", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export function Button({ className, variant, size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

const field = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-brand focus:outline-none";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(field, "h-10", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(field, "min-h-24", className)} {...props} />;
});

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, "h-10", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500", className)} {...props} />;
}

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  // Associate the label with a single form control child so it has an accessible name.
  const autoId = React.useId();
  const control =
    React.isValidElement<{ id?: string }>(children) && children.type !== React.Fragment && !(typeof children.type === "string" && !["input", "select", "textarea"].includes(children.type))
      ? children
      : null;
  const id = control ? (control.props.id ?? autoId) : undefined;
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {control ? React.cloneElement(control, { id }) : children}
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-zinc-200 bg-white shadow-sm", className)} {...props} />;
}

export function CardHeader({ title, action, subtitle }: { title: React.ReactNode; action?: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
      <div>
        <h2 className="font-semibold text-brand-ink">{title}</h2>
        {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const badgeTones = {
  default: "bg-zinc-100 text-zinc-700",
  brand: "bg-brand-soft text-brand",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-700",
} as const;

export function Badge({ tone = "default", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", badgeTones[tone], className)} {...props} />;
}

export function statusTone(status: string): keyof typeof badgeTones {
  if (["sent", "succeeded", "done", "ready", "published", "paid", "confirmed", "released", "approved", "won", "completed", "posted"].includes(status)) return "green";
  if (["failed", "rejected", "lost", "cancelled", "urgent", "spam"].includes(status)) return "red";
  if (["pending", "awaiting_approval", "processing", "running", "queued", "rendering", "generating", "recording", "in_progress"].includes(status)) return "amber";
  return "default";
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-brand-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-brand/25 bg-white px-6 py-12 text-center">
      {icon && <div className="text-brand">{icon}</div>}
      <p className="font-medium text-brand-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-zinc-500">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string }) {
  const inner = (
    <Card className="p-4 transition hover:border-brand/40">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand">{value}</p>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-200">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            active === t.href ? "border-brand text-brand" : "border-transparent text-zinc-500 hover:text-brand-ink",
          )}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 text-xs text-brand">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}
