"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { SKILL_RATING_LABELS } from "@/lib/schemas/monthly-skill";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { X } from "lucide-react";

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
  // Chip-based add: typed skills become pills in `draftSkills` and the
  // current input lives in `draftInput`. Enter/comma commits a chip,
  // backspace at empty input removes the last chip, paste of multi-line
  // text expands into multiple chips at once.
  const [draftSkills, setDraftSkills] = useState<string[]>([]);
  const [draftInput, setDraftInput] = useState("");
  const draftInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerMonth, setPickerMonth] = useState(yearMonth);

  function commitDraft(raw: string) {
    // Split on newlines + commas + tabs so pasting any common list shape
    // (numbered list, CSV, one-per-line) breaks into clean chips.
    const parts = raw
      .split(/[\n,\t]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    if (parts.length === 0) return;
    setDraftSkills((curr) => {
      const seen = new Set(curr.map((c) => c.toLowerCase()));
      const fresh: string[] = [];
      for (const p of parts) {
        if (!seen.has(p.toLowerCase())) {
          seen.add(p.toLowerCase());
          fresh.push(p);
        }
      }
      return [...curr, ...fresh];
    });
  }
  function removeDraftChip(i: number) {
    setDraftSkills((curr) => curr.filter((_, idx) => idx !== i));
  }
  function onDraftKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft(draftInput);
      setDraftInput("");
    } else if (e.key === "Backspace" && draftInput === "" && draftSkills.length > 0) {
      e.preventDefault();
      // Pop last chip back into the input so the admin can edit a typo.
      const last = draftSkills[draftSkills.length - 1]!;
      setDraftSkills((c) => c.slice(0, -1));
      setDraftInput(last);
    }
  }
  function onDraftPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (/[\n\t,]/.test(text)) {
      e.preventDefault();
      commitDraft(text);
      setDraftInput("");
    }
  }
  function onDraftBlur() {
    // Don't lose a half-typed entry on focus loss — commit it.
    if (draftInput.trim().length >= 2) {
      commitDraft(draftInput);
      setDraftInput("");
    }
  }

  function switchMonth(value: string) {
    setPickerMonth(value);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      router.push(`/monthly-skills?month=${value}`);
    }
  }

  async function addSkill() {
    // Flush any half-typed entry into chips first so 'Add' always picks
    // up everything the admin typed (including a value they didn't Enter).
    const pending = draftSkills.slice();
    if (draftInput.trim().length >= 2) {
      const fresh = draftInput
        .split(/[\n,\t]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && !pending.map((p) => p.toLowerCase()).includes(s.toLowerCase()));
      pending.push(...fresh);
    }
    if (pending.length === 0) {
      toast.error("Add at least one skill (2+ characters).");
      return;
    }
    setBusy("__new__");
    try {
      // POST each one — the API rejects duplicates per skill, so a paste
      // with one repeat doesn't kill the rest. Collect per-line failures.
      const results = await Promise.all(
        pending.map(async (label) => {
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
        if (dupes > 0) parts.push(`${dupes} already on this month`);
        if (others > 0) parts.push(`${others} failed`);
        toast.error(parts.join(" · "));
      }
      // Keep only chips that failed for non-duplicate reasons so the
      // admin can see what to fix and retry.
      const failedNonDupe = new Set(failed.filter((r) => r.status !== 409).map((r) => r.label));
      setDraftSkills(pending.filter((p) => failedNonDupe.has(p)));
      setDraftInput("");
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
          <label className="text-[10px] tracking-wider text-muted-foreground">Month</label>
          <Input
            type="month"
            value={pickerMonth}
            onChange={(e) => switchMonth(e.target.value)}
            className="w-40"
          />
        </div>
        {canEdit && (
          <div className="flex-1 min-w-[280px] space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] tracking-wider text-muted-foreground">
                Add skills to track this month
              </label>
              {draftSkills.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {draftSkills.length} ready to add
                </span>
              )}
            </div>
            <div
              onClick={() => draftInputRef.current?.focus()}
              className="flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring"
            >
              {draftSkills.map((s, i) => (
                <span
                  key={`${s}-${i}`}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
                >
                  {s}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDraftChip(i);
                    }}
                    className="rounded-full p-0.5 hover:bg-primary/20"
                    aria-label={`Remove ${s}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                ref={draftInputRef}
                value={draftInput}
                onChange={(e) => setDraftInput(e.target.value)}
                onKeyDown={onDraftKey}
                onPaste={onDraftPaste}
                onBlur={onDraftBlur}
                placeholder={draftSkills.length === 0 ? "Type a skill and press Enter…" : ""}
                className="flex-1 min-w-[140px] border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                Press <kbd className="rounded bg-muted px-1 font-mono">Enter</kbd> or{" "}
                <kbd className="rounded bg-muted px-1 font-mono">,</kbd> to add · paste a list to add many · <kbd className="rounded bg-muted px-1 font-mono">⌫</kbd> on empty input edits the last chip
              </p>
              <Button
                onClick={addSkill}
                disabled={busy === "__new__" || (draftSkills.length === 0 && draftInput.trim().length < 2)}
                size="sm"
              >
                {busy === "__new__"
                  ? "Adding…"
                  : draftSkills.length > 0
                    ? `Add ${draftSkills.length}${draftInput.trim().length >= 2 ? "+1" : ""} skill${draftSkills.length === 1 && draftInput.trim().length < 2 ? "" : "s"}`
                    : "Add Skill"}
              </Button>
            </div>
          </div>
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
            <thead className="bg-muted/30 text-left text-[10px] tracking-wide text-muted-foreground">
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
