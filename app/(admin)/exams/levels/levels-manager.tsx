"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// Discipline is preserved as a hidden schema field (the DB column still
// exists for FK uniqueness), but it's no longer surfaced in the UI — the
// catalog is a flat 4-level ladder driven by the Equiwings PDFs. All new
// levels created from here default to "general".
const HIDDEN_DISCIPLINE = "general";

export function LevelsManager({ initial }: { initial: Level[] }) {
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState({
    orderIndex: "1",
    code: "",
    name: "",
    passThreshold: "70",
    description: "",
  });
  const [busy, setBusy] = useState(false);

  // Flat sorted list — no discipline grouping.
  const rows = initial
    .filter((l) => showInactive || l.active)
    .sort((a, b) => a.orderIndex - b.orderIndex);

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
          discipline: HIDDEN_DISCIPLINE,
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
            ? "A level with that order or code already exists"
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
      <form onSubmit={add} className="grid gap-2 rounded-md border bg-muted/30 p-3 md:grid-cols-6">
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
            placeholder="5"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Name</label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Level 5"
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
        <Button type="submit" disabled={busy} className="md:col-span-1">
          <Plus className="h-4 w-4" /> Add
        </Button>
        <div className="md:col-span-6">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Description (optional)</label>
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What this level tests"
          />
        </div>
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
        <span className="text-muted-foreground">{rows.length} level{rows.length === 1 ? "" : "s"}</span>
      </div>

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
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No levels defined yet — add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
