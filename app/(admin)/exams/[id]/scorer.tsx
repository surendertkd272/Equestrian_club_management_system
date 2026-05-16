"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScoringEngine } from "@/components/scoring/scoring-engine";
import type { RubricCategory } from "@/lib/schemas/exam";
import { Save, FileEdit, RotateCcw } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

export function ExamScorer({
  examId,
  status,
  rubric,
  initialScores,
  passThreshold,
  level,
  judgeId,
  initialDeductions,
  initialTimeFaults,
  canEditAdjustments,
}: {
  examId: string;
  status: string;
  rubric: RubricCategory[];
  initialScores: Record<string, number | string>;
  passThreshold: number;
  level: number;
  // When set, the scorer is acting as a specific co-judge — server routes
  // their submission to ExamJudge.scoresJson instead of the legacy field.
  judgeId?: string | null;
  initialDeductions?: number;
  initialTimeFaults?: number;
  // Deductions/time-faults are typically lead-judge / manager territory.
  // Co-judges score their own card but only the lead enters faults.
  canEditAdjustments?: boolean;
}) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number | string>>(initialScores);
  const [total, setTotal] = useState(0);
  const [deductions, setDeductions] = useState<number>(initialDeductions ?? 0);
  const [timeFaults, setTimeFaults] = useState<number>(initialTimeFaults ?? 0);
  const [busy, setBusy] = useState<null | "draft" | "submit" | "reset">(null);
  const isCompleted = status === "completed";
  const adjusted = Math.max(0, total - deductions - timeFaults);

  async function save(final: boolean) {
    setBusy(final ? "submit" : "draft");
    const res = await fetch(`/api/exams/${examId}/score`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scores,
        final,
        ...(judgeId ? { judgeId } : {}),
        ...(canEditAdjustments ? { deductions, timeFaults } : {}),
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Save failed");
      return;
    }
    const data = await res.json();
    if (final) {
      toast.success(
        data.passed === true ? "Submitted — PASS" : data.passed === false ? "Submitted — fail" : "Submitted",
      );
      router.push("/exams");
    } else {
      toast.success("Draft saved");
    }
    router.refresh();
  }

  async function reset() {
    const ok = await openConfirm({
      title: "Reset this draft?",
      body: "All saved scores will be cleared and the exam will go back to Scheduled.",
      destructive: true,
      confirmLabel: "Reset draft",
    });
    if (!ok) return;
    setBusy("reset");
    const res = await fetch(`/api/exams/${examId}/score`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      toast.error("Reset failed");
      return;
    }
    toast.success("Draft reset");
    setScores({});
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <ScoringEngine
        rubricConfig={rubric}
        initialScores={initialScores}
        readOnly={isCompleted}
        onScoreChange={(s, t) => {
          setScores(s);
          setTotal(t);
        }}
      />

      {canEditAdjustments && !isCompleted && (
        <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Deductions</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={deductions}
              onChange={(e) => setDeductions(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm"
              title="Penalties for course faults, refusals, etc. Subtracted from total."
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Time faults</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={timeFaults}
              onChange={(e) => setTimeFaults(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm"
              title="Time-over-allowed penalties. Subtracted from total."
            />
          </label>
        </div>
      )}

      <div className="sticky bottom-4 space-y-2 rounded-lg border bg-card p-4 shadow-lg">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Rubric subtotal</span>
          <span className="font-mono">{total}</span>
        </div>
        {(deductions > 0 || timeFaults > 0) && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              − deductions {deductions} − time faults {timeFaults}
            </span>
            <span className="font-mono">{adjusted}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Adjusted total</span>
          <span className="text-xl font-bold text-primary">{adjusted}</span>
        </div>
        <div className="text-xs text-muted-foreground">Pass mark: {passThreshold}%</div>

        {!isCompleted && (
          <div className="grid gap-2 sm:grid-cols-3">
            {status === "in_progress" && (
              <Button variant="outline" disabled={busy !== null} onClick={reset} className="border-destructive/40 text-destructive">
                <RotateCcw className="h-4 w-4" />
                {busy === "reset" ? "Resetting…" : "Reset draft"}
              </Button>
            )}
            <Button variant="outline" disabled={busy !== null} onClick={() => save(false)}>
              <FileEdit className="h-4 w-4" />
              {busy === "draft" ? "Saving…" : "Save draft"}
            </Button>
            <Button disabled={busy !== null} onClick={() => save(true)} className="bg-emerald-600 hover:bg-emerald-700">
              <Save className="h-4 w-4" />
              {busy === "submit" ? "Submitting…" : `Lock & submit L${level}`}
            </Button>
          </div>
        )}
        {isCompleted && (
          <div className="rounded-md border bg-muted p-3 text-center text-sm">
            Already submitted. Contact a Super Admin to unlock.
          </div>
        )}
      </div>
    </div>
  );
}
