"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Select, Field, Textarea } from "@/components/ui";

type ParamDef = { key: string; label: string; type: "text" | "textarea" | "number" | "select"; options?: string[] };
type ActionMeta = { type: string; label: string; params: ParamDef[] };
type Cond = { field: string; op: string; value?: string };
type Act = { type: string; params: Record<string, string> };

export function AutomationBuilder({
  action,
  events,
  actions,
  pipelines,
  sequences,
  initial,
}: {
  action: (form: FormData) => Promise<void>;
  events: { type: string; label: string; fields: string[] }[];
  actions: ActionMeta[];
  pipelines: { id: string; name: string }[];
  sequences: { id: string; name: string }[];
  initial?: { name: string; description: string | null; trigger: string; conditions: Cond[]; actions: Act[] };
}) {
  const [trigger, setTrigger] = useState(initial?.trigger ?? events[0].type);
  const [conds, setConds] = useState<Cond[]>(initial?.conditions ?? []);
  const [acts, setActs] = useState<Act[]>(initial?.actions ?? [{ type: "create_task", params: { title: "Follow up with {{name}}", dueInDays: "1", priority: "normal" } }]);
  const fields = events.find((e) => e.type === trigger)?.fields ?? [];

  const paramInput = (a: Act, i: number, p: ParamDef) => {
    const set = (v: string) => setActs(acts.map((x, j) => (j === i ? { ...x, params: { ...x.params, [p.key]: v } } : x)));
    const val = a.params[p.key] ?? "";
    if (p.key === "pipelineId")
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          <option value="">Choose pipeline…</option>
          {pipelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
      );
    if (p.key === "sequenceId")
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          <option value="">Choose sequence…</option>
          {sequences.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
      );
    if (p.type === "select")
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          {/* An unset param is saved as "" (the action's default) — show that instead of implying the first option. */}
          {!p.options?.includes(val) && <option value={val}>Default</option>}
          {(p.options ?? []).map((o) => <option key={o}>{o}</option>)}
        </Select>
      );
    if (p.type === "textarea") return <Textarea value={val} onChange={(e) => set(e.target.value)} className="min-h-16" />;
    return <Input type={p.type === "number" ? "number" : "text"} value={val} onChange={(e) => set(e.target.value)} />;
  };

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="conditions" value={JSON.stringify(conds)} />
      <input type="hidden" name="actions" value={JSON.stringify(acts)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input name="name" defaultValue={initial?.name} required /></Field>
        <Field label="When this happens">
          <Select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {events.map((e) => <option key={e.type} value={e.type}>{e.label}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Description"><Input name="description" defaultValue={initial?.description ?? ""} /></Field>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Only if (optional)</p>
        {conds.map((c, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <Select aria-label="Condition field" value={c.field} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
              {[...fields.map((f) => `payload.${f}`), "contact.tags", "contact.relationshipTypes", "contact.email", "contact.phone"].map((f) => <option key={f}>{f}</option>)}
            </Select>
            <Select aria-label="Condition operator" value={c.op} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))} className="w-36">
              <option value="eq">equals</option>
              <option value="neq">not equal</option>
              <option value="contains">contains</option>
              <option value="exists">is set</option>
              <option value="gt">greater than</option>
              <option value="lt">less than</option>
            </Select>
            <Input value={c.value ?? ""} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="value" aria-label="Condition value" />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove condition" onClick={() => setConds(conds.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button type="button" variant="soft" size="sm" onClick={() => setConds([...conds, { field: `payload.${fields[0] ?? "contactId"}`, op: "eq", value: "" }])}>
          <Plus className="h-3.5 w-3.5" /> Condition
        </Button>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Do this</p>
        {acts.map((a, i) => {
          const meta = actions.find((x) => x.type === a.type);
          return (
            <div key={i} className="mb-3 rounded-lg border border-zinc-200 p-3">
              <div className="mb-2 flex gap-2">
                <span className="grid h-10 w-8 place-items-center text-sm font-bold text-brand">{i + 1}</span>
                <Select aria-label={`Action ${i + 1}`} value={a.type} onChange={(e) => setActs(acts.map((x, j) => (j === i ? { type: e.target.value, params: {} } : x)))}>
                  {actions.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
                </Select>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove action" onClick={() => setActs(acts.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {meta?.params.map((p) => (
                  <Field key={p.key} label={p.label} className={p.type === "textarea" ? "sm:col-span-2" : undefined}>
                    {paramInput(a, i, p)}
                  </Field>
                ))}
              </div>
            </div>
          );
        })}
        <Button type="button" variant="soft" size="sm" onClick={() => setActs([...acts, { type: "create_task", params: {} }])}>
          <Plus className="h-3.5 w-3.5" /> Action
        </Button>
        <p className="mt-2 text-xs text-zinc-500">
          Use {"{{name}}"}, {"{{first_name}}"}, {"{{contact.email}}"} or {"{{payload.<field>}}"} in text. Anything that reaches people is drafted to Approvals.
        </p>
      </div>
      <Button>Save automation</Button>
    </form>
  );
}
