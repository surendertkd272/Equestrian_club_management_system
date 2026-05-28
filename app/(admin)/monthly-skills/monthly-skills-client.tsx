"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { SKILL_RATING_LABELS } from "@/lib/schemas/monthly-skill";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Skill = { id: string; skillLabel: string; orderIndex: number; active: boolean };
type Rider = { id: string; name: string };
type Mark = { rating: number; coachNotes: string | null };

type Props = {
  yearMonth: string;
  skills: Skill[];
  riders: Rider[];
  initialMarks: Record<string, Mark>;
};

const RATING_COLOURS: Record<number, string> = {
  0: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 border-zinc-300",
  1: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-300",
  2: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300 border-sky-300",
  3: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300",
};

export function MonthlySkillsClient({ yearMonth, skills, riders, initialMarks }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>(initialMarks);
  const [newSkill, setNewSkill] = useState("");
  const [pickerMonth, setPickerMonth] = useState(yearMonth);

  function switchMonth(value: string) {
    setPickerMonth(value);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      router.push(`/monthly-skills?month=${value}`);
    }
  }

  async function addSkill() {
    if (newSkill.trim().length < 2) {
      toast.error("Label is too short.");
      return;
    }
    setBusy("__new__");
    try {
      const res = await fetch("/api/monthly-skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth, skillLabel: newSkill.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error === "DUPLICATE_SKILL" ? "That skill is already tracked this month." : data.error ?? "Failed");
        return;
      }
      toast.success("Skill added");
      setNewSkill("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function removeSkill(id: string, label: string) {
    const ok = await openConfirm({
      title: "Deactivate skill?",
      body: `"${label}" will be removed from this month. Past ratings stay intact.`,
      confirmLabel: "Deactivate",
    });
    if (!ok) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/monthly-skills/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Removed");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function mark(catalogId: string, riderId: string, rating: number) {
    const key = `${catalogId}:${riderId}`;
    const prev = marks[key];
    // Optimistic update; rollback if the request fails.
    setMarks((m) => ({ ...m, [key]: { rating, coachNotes: m[key]?.coachNotes ?? null } }));
    setBusy(key);
    try {
      const res = await fetch("/api/monthly-skills/marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogId, riderId, rating }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        setMarks((m) => ({ ...m, [key]: prev ?? { rating: 0, coachNotes: null } }));
        return;
      }
    } finally {
      setBusy(null);
    }
  }

  const activeSkills = skills.filter((s) => s.active);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Month</label>
          <Input
            type="month"
            value={pickerMonth}
            onChange={(e) => switchMonth(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Add a skill to track this month
          </label>
          <Input
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            placeholder="e.g. Posting trot · diagonal balance"
            maxLength={120}
            onKeyDown={(e) => {
              if (e.key === "Enter") addSkill();
            }}
          />
        </div>
        <Button onClick={addSkill} disabled={busy === "__new__"}>
          {busy === "__new__" ? "Adding…" : "Add skill"}
        </Button>
      </div>

      {activeSkills.length === 0 ? (
        <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
          No skills tracked for {yearMonth} yet. Add one above to start.
        </div>
      ) : riders.length === 0 ? (
        <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
          No active riders to rate.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 w-48">Rider</th>
                {activeSkills.map((s) => (
                  <th key={s.id} className="px-3 py-2 min-w-[140px]">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium normal-case">{s.skillLabel}</span>
                      <button
                        type="button"
                        onClick={() => removeSkill(s.id, s.skillLabel)}
                        disabled={busy === s.id}
                        className="text-[10px] text-muted-foreground hover:text-destructive"
                        aria-label="Deactivate skill"
                      >
                        ×
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {riders.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium">{r.name}</td>
                  {activeSkills.map((s) => {
                    const key = `${s.id}:${r.id}`;
                    const current = marks[key]?.rating ?? 0;
                    return (
                      <td key={s.id} className="px-2 py-2">
                        <div className="flex gap-1">
                          {[0, 1, 2, 3].map((rating) => (
                            <button
                              key={rating}
                              type="button"
                              onClick={() => mark(s.id, r.id, rating)}
                              disabled={busy === key}
                              className={`h-7 w-7 rounded border text-xs font-medium transition ${
                                current === rating
                                  ? RATING_COLOURS[rating]
                                  : "border-input bg-background text-muted-foreground hover:bg-muted"
                              }`}
                              title={SKILL_RATING_LABELS[rating]}
                            >
                              {rating}
                            </button>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="font-semibold">Legend:</span>
        {[0, 1, 2, 3].map((r) => (
          <Badge key={r} variant="outline" className={RATING_COLOURS[r]}>
            {r} · {SKILL_RATING_LABELS[r]}
          </Badge>
        ))}
      </div>
    </div>
  );
}
