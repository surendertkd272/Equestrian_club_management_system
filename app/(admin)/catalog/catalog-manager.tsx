"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type FeePlan = { id: string; levelName: string; monthlyAmount: number; registrationAmount: number };
type Skill = { id: string; discipline: string; name: string };
type Level = { id: string; name: string; order: number; skills: Skill[] };

export function CatalogManager({ feePlans, levels }: { feePlans: FeePlan[]; levels: Level[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function call(method: string, url: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(humanError(data.error) ?? "Failed");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <FeePlansCard feePlans={feePlans} busy={busy} call={call} />
      <LevelsCard levels={levels} busy={busy} call={call} />
      <SkillsCard levels={levels} busy={busy} call={call} />
    </div>
  );
}

function humanError(code?: string): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    DUPLICATE_LEVEL: "A fee plan with that level name already exists.",
    DUPLICATE_NAME: "A level with that name already exists.",
    LEVEL_IN_USE: "Clear this level's components and exam history before deleting it.",
    SKILL_IN_USE: "Riders have progress recorded against this component — can't delete it.",
  };
  return map[code] ?? code;
}

// ── Fee plans ──────────────────────────────────────────────────────────────
function FeePlansCard({ feePlans, busy, call }: { feePlans: FeePlan[]; busy: boolean; call: any }) {
  const [draft, setDraft] = useState({ levelName: "", monthlyAmount: "", registrationAmount: "" });
  const [edit, setEdit] = useState<Record<string, { monthlyAmount: string; registrationAmount: string }>>({});

  async function add() {
    if (!draft.levelName.trim()) return toast.error("Enter a level name.");
    if (await call("POST", "/api/fee-plans", {
      levelName: draft.levelName.trim(),
      monthlyAmount: Number(draft.monthlyAmount) || 0,
      registrationAmount: Number(draft.registrationAmount) || 0,
    })) setDraft({ levelName: "", monthlyAmount: "", registrationAmount: "" });
  }
  async function remove(f: FeePlan) {
    if (!(await openConfirm({ title: "Delete fee plan?", body: `"${f.levelName}" pricing will be removed.`, confirmLabel: "Delete", destructive: true }))) return;
    call("DELETE", `/api/fee-plans/${f.id}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fee Plans</CardTitle>
        <CardDescription>Monthly + registration pricing per level for this club.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr><th className="pb-2">Level</th><th className="pb-2">Monthly ₹</th><th className="pb-2">Registration ₹</th><th /></tr>
            </thead>
            <tbody>
              {feePlans.map((f) => {
                const e = edit[f.id];
                return (
                  <tr key={f.id} className="border-t">
                    <td className="py-2 font-medium">{f.levelName}</td>
                    <td className="py-2">
                      <Input className="h-8 w-28" type="number" defaultValue={f.monthlyAmount}
                        onChange={(ev) => setEdit((p) => ({ ...p, [f.id]: { ...(p[f.id] ?? { monthlyAmount: String(f.monthlyAmount), registrationAmount: String(f.registrationAmount) }), monthlyAmount: ev.target.value } }))} />
                    </td>
                    <td className="py-2">
                      <Input className="h-8 w-28" type="number" defaultValue={f.registrationAmount}
                        onChange={(ev) => setEdit((p) => ({ ...p, [f.id]: { ...(p[f.id] ?? { monthlyAmount: String(f.monthlyAmount), registrationAmount: String(f.registrationAmount) }), registrationAmount: ev.target.value } }))} />
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {e && (
                        <Button size="sm" variant="outline" disabled={busy}
                          onClick={() => call("PATCH", `/api/fee-plans/${f.id}`, { monthlyAmount: Number(e.monthlyAmount), registrationAmount: Number(e.registrationAmount) })}>
                          Save
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => remove(f)}>Delete</Button>
                    </td>
                  </tr>
                );
              })}
              {feePlans.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No fee plans yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
          <div><label className="text-[10px] uppercase text-muted-foreground">Level name</label><Input className="h-9 w-40" value={draft.levelName} onChange={(e) => setDraft((d) => ({ ...d, levelName: e.target.value }))} placeholder="Beginner" /></div>
          <div><label className="text-[10px] uppercase text-muted-foreground">Monthly ₹</label><Input className="h-9 w-28" type="number" value={draft.monthlyAmount} onChange={(e) => setDraft((d) => ({ ...d, monthlyAmount: e.target.value }))} /></div>
          <div><label className="text-[10px] uppercase text-muted-foreground">Registration ₹</label><Input className="h-9 w-28" type="number" value={draft.registrationAmount} onChange={(e) => setDraft((d) => ({ ...d, registrationAmount: e.target.value }))} /></div>
          <Button onClick={add} disabled={busy}>Add Fee Plan</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Progress levels ──────────────────────────────────────────────────────────
function LevelsCard({ levels, busy, call }: { levels: Level[]; busy: boolean; call: any }) {
  const [draft, setDraft] = useState({ name: "", order: "" });
  async function add() {
    if (!draft.name.trim()) return toast.error("Enter a level name.");
    if (await call("POST", "/api/progress-levels", { name: draft.name.trim(), order: Number(draft.order) || levels.length + 1 }))
      setDraft({ name: "", order: "" });
  }
  async function remove(l: Level) {
    if (!(await openConfirm({ title: "Delete level?", body: `"${l.name}" will be removed (only if it has no components or exam history).`, confirmLabel: "Delete", destructive: true }))) return;
    call("DELETE", `/api/progress-levels/${l.id}`);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Progress Levels</CardTitle>
        <CardDescription>The ladder riders climb (Beginner → Advanced). Order controls display + promotion sequence.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-md border">
          {levels.map((l) => (
            <li key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span><span className="font-mono text-xs text-muted-foreground">#{l.order}</span> <span className="font-medium">{l.name}</span> <Badge variant="outline" className="ml-1 text-[10px]">{l.skills.length} components</Badge></span>
              <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => remove(l)}>Delete</Button>
            </li>
          ))}
          {levels.length === 0 && <li className="px-3 py-4 text-center text-muted-foreground">No levels yet.</li>}
        </ul>
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
          <div><label className="text-[10px] uppercase text-muted-foreground">Level name</label><Input className="h-9 w-40" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Intermediate" /></div>
          <div><label className="text-[10px] uppercase text-muted-foreground">Order</label><Input className="h-9 w-20" type="number" value={draft.order} onChange={(e) => setDraft((d) => ({ ...d, order: e.target.value }))} placeholder={String(levels.length + 1)} /></div>
          <Button onClick={add} disabled={busy}>Add Level</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Components (the exam/level skill catalog) ────────────────────────────────
function SkillsCard({ levels, busy, call }: { levels: Level[]; busy: boolean; call: any }) {
  // Collect distinct discipline (category) values from the existing components
  // so the input's datalist suggests what's already in use — matches the
  // rubric category names (Dress Code, Know Your Horse, etc.) without
  // hard-coding them.
  const existingDisciplines = Array.from(
    new Set(levels.flatMap((l) => l.skills.map((s) => s.discipline))),
  ).sort();
  const seedDiscipline = existingDisciplines[0] ?? "Riding Knowledge";
  const [draft, setDraft] = useState({ levelId: levels[0]?.id ?? "", discipline: seedDiscipline, name: "" });
  async function add() {
    if (!draft.levelId) return toast.error("Add a level first.");
    if (!draft.name.trim()) return toast.error("Enter a component name.");
    if (await call("POST", "/api/skills", { levelId: draft.levelId, discipline: draft.discipline, name: draft.name.trim() }))
      setDraft((d) => ({ ...d, name: "" }));
  }
  async function remove(s: Skill) {
    if (!(await openConfirm({ title: "Delete component?", body: `"${s.name}" will be removed (only if no rider progress recorded).`, confirmLabel: "Delete", destructive: true }))) return;
    call("DELETE", `/api/skills/${s.id}`);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Components</CardTitle>
        <CardDescription>The exam components coaches assess, grouped by level + category. Category is free-text — pick from the autocomplete (matches the exam rubric sections) or type a new one. (Distinct from the month-by-month skills tracked under Monthly Skills.)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {levels.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add a progress level first, then attach components to it.</p>
        ) : (
          levels.map((l) => (
            <div key={l.id}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{l.name}</div>
              {l.skills.length === 0 ? (
                <p className="px-1 py-1 text-xs text-muted-foreground">No components.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {l.skills.map((s) => (
                    <li key={s.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span><Badge variant="outline" className="mr-2 text-[10px]">{s.discipline}</Badge>{s.name}</span>
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => remove(s)}>Delete</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
        {levels.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
            <div><label className="text-[10px] uppercase text-muted-foreground">Level</label>
              <Select className="h-9 w-36" value={draft.levelId} onChange={(e) => setDraft((d) => ({ ...d, levelId: e.target.value }))}>
                {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-muted-foreground">Category</label>
              <Input
                className="h-9 w-40"
                value={draft.discipline}
                onChange={(e) => setDraft((d) => ({ ...d, discipline: e.target.value }))}
                placeholder="Riding Knowledge"
                list="skill-category-suggestions"
              />
              <datalist id="skill-category-suggestions">
                {existingDisciplines.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
            <div className="flex-1 min-w-[160px]"><label className="text-[10px] uppercase text-muted-foreground">Component</label><Input className="h-9" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Posting trot" /></div>
            <Button onClick={add} disabled={busy}>Add Component</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
