"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { SKILL_RATING_LABELS } from "@/lib/schemas/monthly-skill";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Skill = { id: string; skillLabel: string; orderIndex: number; active: boolean };
type Rider = { id: string; name: string };
type Mark = { rating: number; coachNotes: string | null };

type Props = {
  yearMonth: string;
  // false for SCHOOL_ADMINISTRATOR + any future read-only role. When false,
  // the add-skill input, remove-skill ×, and rating buttons all hide;
  // the page becomes a read-only matrix.
  canEdit: boolean;
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

export function MonthlySkillsClient({ yearMonth, canEdit, skills, riders, initialMarks }: Props) {
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
    // Accept multi-line input — split on newlines so the admin can paste
    // a list ('Posting trot\nDiagonal balance\nLeg yield') and create all
    // in one go. Single-skill flow still works: typing one line + Enter.
    const labels = newSkill
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    if (labels.length === 0) {
      toast.error("Add at least one skill (2+ characters per line).");
      return;
    }
    setBusy("__new__");
    try {
      // POST each one — the API rejects duplicates per skill, so a paste
      // with one repeat doesn't kill the rest. Collect per-line failures.
      const results = await Promise.all(
        labels.map(async (label) => {
          const res = await fetch("/api/monthly-skills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ yearMonth, skillLabel: label }),
          });
          return { label, ok: res.ok, status: res.status };
        }),
      );
      const added = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      if (added.length > 0) {
        toast.success(
          added.length === 1
            ? "Skill added"
            : `${added.length} skill${added.length === 1 ? "" : "s"} added`,
        );
      }
      if (failed.length > 0) {
        const dupes = failed.filter((r) => r.status === 409).length;
        const others = failed.length - dupes;
        const parts: string[] = [];
        if (dupes > 0) parts.push(`${dupes} duplicate${dupes === 1 ? "" : "s"}`);
        if (others > 0) parts.push(`${others} failed`);
        toast.error(`${parts.join(", ")} — see list for which.`);
      }
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
        {canEdit && (
          <>
            <div className="flex-1 min-w-[280px]">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Add skills to track this month
              </label>
              <Textarea
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                placeholder={"One skill per line — paste a list to add many at once.\ne.g.\nPosting trot · diagonal balance\nLeg yield\nCanter departure"}
                rows={3}
                className="font-mono text-sm"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Hit the button to add — Enter inserts a new line so you can paste multi-line lists.
              </p>
            </div>
            <Button onClick={addSkill} disabled={busy === "__new__"} className="self-start">
              {busy === "__new__" ? "Adding…" : "Add skill(s)"}
            </Button>
          </>
        )}
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
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => removeSkill(s.id, s.skillLabel)}
                          disabled={busy === s.id}
                          className="text-[10px] text-muted-foreground hover:text-destructive"
                          aria-label="Deactivate skill"
                        >
                          ×
                        </button>
                      )}
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
                            // Read-only roles see the current rating as a
                            // static badge — disabled+styled, no click. Edit
                            // roles get the full clickable rating selector.
                            <button
                              key={rating}
                              type="button"
                              onClick={canEdit ? () => mark(s.id, r.id, rating) : undefined}
                              disabled={!canEdit || busy === key}
                              className={`h-7 w-7 rounded border text-xs font-medium transition ${
                                current === rating
                                  ? RATING_COLOURS[rating]
                                  : "border-input bg-background text-muted-foreground" +
                                    (canEdit ? " hover:bg-muted" : " opacity-40")
                              }${canEdit ? "" : " cursor-default"}`}
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
