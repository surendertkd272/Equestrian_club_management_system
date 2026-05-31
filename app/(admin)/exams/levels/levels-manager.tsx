"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Archive, ChevronDown, ChevronRight } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

type RubricItem = { name: string; max_score: number | null; subitems?: RubricItem[] };
type RubricCategory = { name: string; items: RubricItem[] };

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
  // Canonical rubric JSON (ExamLevel.defaultRubricJson). Read-only here —
  // edits flow through /exams/templates per-centre. Null on legacy rows
  // that pre-date the rubric column.
  rubric: unknown;
};

// Walk a rubric tree and count leaf items + sum max scores. Sub-items
// (Level 3's Small Jumps, Level 4's Gallop Run + Tent Pegging) contribute
// to both totals; their parent grouping item with max_score:null doesn't.
function rubricSummary(rubric: unknown): { categories: number; items: number; total: number } {
  const cats = Array.isArray(rubric) ? (rubric as RubricCategory[]) : [];
  let items = 0;
  let total = 0;
  for (const c of cats) {
    for (const i of c.items ?? []) {
      if (Array.isArray(i.subitems) && i.subitems.length > 0) {
        for (const s of i.subitems) {
          items += 1;
          total += s.max_score ?? 0;
        }
      } else {
        items += 1;
        total += i.max_score ?? 0;
      }
    }
  }
  return { categories: cats.length, items, total };
}

// Discipline is preserved as a hidden schema field (the DB column still
// exists for FK uniqueness), but it's no longer surfaced in the UI — the
// catalog is a flat 4-level ladder driven by the Equiwings PDFs. All new
// levels created from here default to "general".
const HIDDEN_DISCIPLINE = "general";

export function LevelsManager({ initial }: { initial: Level[] }) {
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({
    orderIndex: "1",
    code: "",
    name: "",
    passThreshold: "70",
    description: "",
  });
  const [busy, setBusy] = useState(false);

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2 w-14">Order</th>
              <th className="px-3 py-2 w-24">Code</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 w-20">Pass %</th>
              <th className="px-3 py-2 w-44">Components</th>
              <th className="px-3 py-2 w-32">Adoption</th>
              <th className="px-3 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const isOpen = expanded.has(l.id);
              const summary = rubricSummary(l.rubric);
              return (
              <Fragment key={l.id}>
                  <tr className={`border-t ${l.active ? "" : "opacity-60"}`}>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpand(l.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={isOpen ? "Collapse components" : "Expand components"}
                        title={isOpen ? "Hide components" : "Show components"}
                      >
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </td>
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
                      {summary.items > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(l.id)}
                          className="text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
                          title="Click to expand"
                        >
                          {summary.categories} sections · {summary.items} items · /{summary.total}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
                  {isOpen && (
                    <tr className="border-t bg-muted/20">
                      <td></td>
                      <td colSpan={7} className="px-3 py-3">
                        {summary.items === 0 ? (
                          <div className="text-xs text-muted-foreground">
                            No rubric components defined yet for this level. Update prisma/equiwings-level-rubrics.json + redeploy + re-heal to populate.
                          </div>
                        ) : (
                          <RubricView rubric={l.rubric} />
                        )}
                      </td>
                    </tr>
                  )}
              </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">
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

// Read-only renderer for a rubric. Each category gets its own pill with
// the items + max scores listed beneath. Sub-items (Level 3 Small Jumps,
// Level 4 Gallop Run / Tent Pegging) are nested under their parent with
// a slight indent so the structure mirrors the PDF.
function RubricView({ rubric }: { rubric: unknown }) {
  const cats = Array.isArray(rubric) ? (rubric as RubricCategory[]) : [];
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Read-only view from the canonical rubric. Edits flow through{" "}
        <code className="rounded bg-background px-1 py-0.5">prisma/equiwings-level-rubrics.json</code>{" "}
        + redeploy. Per-centre overrides are edited on{" "}
        <a href="/exams/templates" className="text-primary underline">Scoring templates</a>.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {cats.map((c) => (
          <div key={c.name} className="rounded-md border bg-card p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {c.name}
            </div>
            <ul className="space-y-1 text-xs">
              {c.items.map((item, idx) => {
                if (Array.isArray(item.subitems) && item.subitems.length > 0) {
                  return (
                    <li key={`${item.name}-${idx}`}>
                      <div className="font-medium">{item.name}</div>
                      <ul className="ml-3 mt-1 space-y-0.5 border-l pl-2">
                        {item.subitems.map((sub, sidx) => (
                          <li key={`${sub.name}-${sidx}`} className="flex justify-between gap-2 text-muted-foreground">
                            <span>{sub.name}</span>
                            <span className="font-mono text-[10px]">/{sub.max_score ?? "—"}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                }
                return (
                  <li key={`${item.name}-${idx}`} className="flex justify-between gap-2">
                    <span>{item.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">/{item.max_score ?? "—"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
