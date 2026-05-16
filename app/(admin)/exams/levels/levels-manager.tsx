"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Archive } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Level = {
  id: string;
  discipline: string;
  orderIndex: number;
  code: string;
  name: string;
  passThreshold: number;
  description: string | null;
  minExaminerLevel: number | null;
  active: boolean;
  adoptedBy: number;
};

const DISCIPLINES = ["general", "dressage", "jumping", "eventing", "gymkhana", "endurance", "vaulting", "polo"];

export function LevelsManager({ initial }: { initial: Level[] }) {
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState({
    discipline: "general",
    orderIndex: "1",
    code: "",
    name: "",
    passThreshold: "70",
    description: "",
  });
  const [busy, setBusy] = useState(false);

  // Group by discipline for the cleaner display the user asked for —
  // discipline header, then ordered rows underneath. No more "Level 1
  // Level 2 Level 1 Level 2" repetition.
  const grouped = new Map<string, Level[]>();
  for (const l of initial) {
    if (!showInactive && !l.active) continue;
    if (!grouped.has(l.discipline)) grouped.set(l.discipline, []);
    grouped.get(l.discipline)!.push(l);
  }
  for (const arr of grouped.values()) arr.sort((a, b) => a.orderIndex - b.orderIndex);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code || !form.name) {
      toast.error("Code and name are required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/exam-levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discipline: form.discipline,
          orderIndex: Number(form.orderIndex),
          code: form.code,
          name: form.name,
          passThreshold: Number(form.passThreshold),
          description: form.description || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.error === "DUPLICATE"
            ? "A level with that discipline + order or code already exists"
            : (data.error ?? "Failed"),
        );
        return;
      }
      toast.success("Level added");
      setForm((f) => ({ ...f, code: "", name: "", description: "" }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, msg?: string) {
    const res = await fetch(`/api/exam-levels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("Save failed");
      return false;
    }
    if (msg) toast.success(msg);
    router.refresh();
    return true;
  }

  async function remove(id: string, adoptedBy: number) {
    const ok = await openConfirm({
      title: adoptedBy > 0 ? "Archive this level?" : "Delete this level?",
      body:
        adoptedBy > 0
          ? `${adoptedBy} centre rubric(s) reference this level — it will be hidden but not removed so history stays intact.`
          : "No centre uses it — it will be deleted.",
      destructive: true,
      confirmLabel: adoptedBy > 0 ? "Archive" : "Delete",
    });
    if (!ok) return;
    const res = await fetch(`/api/exam-levels/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed");
      return;
    }
    toast.success(adoptedBy > 0 ? "Archived" : "Deleted");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="grid gap-2 rounded-md border bg-muted/30 p-3 md:grid-cols-7">
        <div className="md:col-span-2">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Discipline</label>
          <Select value={form.discipline} onChange={(e) => setForm({ ...form, discipline: e.target.value })}>
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Order</label>
          <Input
            type="number"
            min={1}
            value={form.orderIndex}
            onChange={(e) => setForm({ ...form, orderIndex: e.target.value })}
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Code</label>
          <Input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="1 / Stage 2 / D"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Name</label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Beginner / Foundation / Preliminary"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Pass %</label>
          <Input
            type="number"
            min={0}
            max={100}
            value={form.passThreshold}
            onChange={(e) => setForm({ ...form, passThreshold: e.target.value })}
          />
        </div>
        <div className="md:col-span-6">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Description (optional)</label>
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What this level tests"
          />
        </div>
        <Button type="submit" disabled={busy} className="md:col-span-1">
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>

      <div className="flex items-center justify-between text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {[...grouped.entries()].map(([discipline, rows]) => (
        <div key={discipline}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {discipline}
            <span className="text-[10px] font-normal opacity-60">({rows.length})</span>
          </h3>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 w-14">Order</th>
                  <th className="px-3 py-2 w-24">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 w-20">Pass %</th>
                  <th className="px-3 py-2 w-32">Adoption</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className={`border-t ${l.active ? "" : "opacity-60"}`}>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number"
                        defaultValue={l.orderIndex}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v === l.orderIndex) return;
                          patch(l.id, { orderIndex: v }, "Re-ordered");
                        }}
                        className="h-8 w-16"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        defaultValue={l.code}
                        onBlur={(e) => {
                          if (e.target.value === l.code) return;
                          patch(l.id, { code: e.target.value }, "Code updated");
                        }}
                        className="h-8 w-20 font-mono"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        defaultValue={l.name}
                        onBlur={(e) => {
                          if (e.target.value === l.name) return;
                          patch(l.id, { name: e.target.value }, "Name updated");
                        }}
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number"
                        defaultValue={l.passThreshold}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v === l.passThreshold) return;
                          patch(l.id, { passThreshold: v }, "Pass mark updated");
                        }}
                        className="h-8 w-16"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      {l.adoptedBy > 0 ? (
                        <Badge variant="outline" className="text-[10px]">
                          {l.adoptedBy} centre{l.adoptedBy === 1 ? "" : "s"}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      {!l.active && <Badge variant="destructive" className="ml-1 text-[10px]">archived</Badge>}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => remove(l.id, l.adoptedBy)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="archive/delete"
                        title={l.adoptedBy > 0 ? "Archive" : "Delete"}
                      >
                        {l.adoptedBy > 0 ? <Archive className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {grouped.size === 0 && (
        <div className="rounded-md border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
          No levels defined yet — add one above.
        </div>
      )}
    </div>
  );
}
