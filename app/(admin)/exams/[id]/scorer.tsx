"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { patchJson, deleteJson } from "@/lib/client/post-json";
import { Button } from "@/components/ui/button";
import { ScoringEngine } from "@/components/scoring/scoring-engine";
import type { RubricCategory } from "@/lib/schemas/exam";
import { Save, FileEdit, RotateCcw } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

type SubmitResult = { passed?: boolean | null; completed?: boolean; waitingFor?: string[] };
type Card = { scores: Record<string, number | string>; deductions: number; timeFaults: number };
type LocalCopy = Card & { at: number };

// A judge marks on a phone in the arena, where the signal comes and goes.
// Marks used to live only in the open page until Save was pressed: a failed
// save followed by a reload lost the card. Now every change is also kept on
// the phone (localStorage, per judge per exam) until the server has it, and
// drafts save themselves when the judge pauses and whenever the connection
// comes back. Wrapped in try/catch: storage can be full, blocked or private.
const AUTOSAVE_MS = 15_000;
const localKey = (cardKey: string) => `ew:exam-card:${cardKey}`;
function readLocal(cardKey: string): LocalCopy | null {
  try {
    const raw = window.localStorage.getItem(localKey(cardKey));
    return raw ? (JSON.parse(raw) as LocalCopy) : null;
  } catch {
    return null;
  }
}
function writeLocal(cardKey: string, c: LocalCopy) {
  try {
    window.localStorage.setItem(localKey(cardKey), JSON.stringify(c));
  } catch {
    /* storage full or blocked — the in-page copy still stands */
  }
}
function clearLocal(cardKey: string) {
  try {
    window.localStorage.removeItem(localKey(cardKey));
  } catch {
    /* ignore */
  }
}
const sameCard = (a: Card, b: Card) =>
  JSON.stringify(a.scores) === JSON.stringify(b.scores) && a.deductions === b.deductions && a.timeFaults === b.timeFaults;

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
  cardSubmitted = false,
  waitingFor = [],
  canReopen = false,
  cardKey,
}: {
  // Identifies this judge's card on this exam, for the copy kept on the phone.
  cardKey: string;
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
  // This card is locked, but the exam is still waiting on other judges.
  cardSubmitted?: boolean;
  // Judges whose card is still open.
  waitingFor?: string[];
  // A manager can reopen a completed exam for correction (see ReopenExam).
  canReopen?: boolean;
}) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number | string>>(initialScores);
  const [total, setTotal] = useState(0);
  const [deductions, setDeductions] = useState<number>(initialDeductions ?? 0);
  const [timeFaults, setTimeFaults] = useState<number>(initialTimeFaults ?? 0);
  const [busy, setBusy] = useState<null | "draft" | "submit" | "reset">(null);
  // ScoringEngine hydrates from initialScores once and then owns its state.
  // Bumping this key remounts it — the only way to make a reset visible;
  // clearing our own copy left the old marks on screen, and the next tap sent
  // every one of them back to the server.
  const [engineKey, setEngineKey] = useState(0);
  const [engineInitial, setEngineInitial] = useState(initialScores);
  // Snapshot of what's on the server. Updated after every successful save.
  // Lets us tell the examiner whether they have unsaved changes — important
  // for the 'mid-exam halt' case where they need confidence their work is safe.
  const [savedSnapshot, setSavedSnapshot] = useState({
    scores: initialScores,
    deductions: initialDeductions ?? 0,
    timeFaults: initialTimeFaults ?? 0,
  });
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(
    Object.keys(initialScores).length > 0 ? new Date() : null,
  );
  // "offline": the last autosave couldn't reach the server — marks are safe
  // on the phone and go up when the connection is back.
  const [sync, setSync] = useState<"idle" | "saving" | "offline" | "error">("idle");
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const busyRef = useRef(false);
  const isCompleted = status === "completed";
  const locked = isCompleted || cardSubmitted;
  const adjusted = Math.max(0, total - deductions - timeFaults);
  const hasSavedMarks = Object.keys(savedSnapshot.scores).length > 0;

  // Has anything changed since the last save? Cheap deep-compare via JSON
  // since the score map is small (≤ a few dozen keys).
  const isDirty =
    JSON.stringify(scores) !== JSON.stringify(savedSnapshot.scores) ||
    deductions !== savedSnapshot.deductions ||
    timeFaults !== savedSnapshot.timeFaults;

  // On opening: a copy on this phone that the server never got (a save that
  // failed, a reload, a dead battery) is put back on the card.
  useEffect(() => {
    if (locked) {
      clearLocal(cardKey);
      return;
    }
    const local = readLocal(cardKey);
    if (!local) return;
    const server = { scores: initialScores, deductions: initialDeductions ?? 0, timeFaults: initialTimeFaults ?? 0 };
    if (sameCard(local, server)) {
      clearLocal(cardKey);
      return;
    }
    setEngineInitial(local.scores);
    setScores(local.scores);
    setDeductions(local.deductions);
    setTimeFaults(local.timeFaults);
    setEngineKey((k) => k + 1);
    setRestoredAt(local.at);
    // Once, on mount — the server copy it compares against is the initial one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the phone's copy current while there are unsaved marks.
  useEffect(() => {
    if (locked || !isDirty) return;
    writeLocal(cardKey, { scores, deductions, timeFaults, at: Date.now() });
  }, [cardKey, locked, isDirty, scores, deductions, timeFaults]);

  const body = useCallback(
    (final: boolean, allowIncomplete = false) => ({
      scores,
      final,
      ...(allowIncomplete ? { allowIncomplete: true } : {}),
      ...(judgeId ? { judgeId } : {}),
      ...(canEditAdjustments ? { deductions, timeFaults } : {}),
    }),
    [scores, judgeId, canEditAdjustments, deductions, timeFaults],
  );

  // Quiet draft save: no toasts, just the status line.
  const autosave = useCallback(async () => {
    if (busyRef.current || locked) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSync("offline");
      return;
    }
    busyRef.current = true;
    setSync("saving");
    const sent = { scores: { ...scores }, deductions, timeFaults };
    const res = await patchJson<SubmitResult>(`/api/exams/${examId}/score`, body(false));
    busyRef.current = false;
    if (!res.ok) {
      setSync(res.status === 0 ? "offline" : "error");
      return;
    }
    setSavedSnapshot(sent);
    setLastSavedAt(new Date());
    setSync("idle");
    setRestoredAt(null);
    // Only drop the phone copy if nothing changed while the save was in flight.
    const local = readLocal(cardKey);
    if (!local || sameCard(local, sent)) clearLocal(cardKey);
  }, [busyRef, locked, scores, deductions, timeFaults, examId, body, cardKey]);

  // Save a draft by itself once the judge pauses.
  useEffect(() => {
    if (!isDirty || locked) return;
    const t = setTimeout(autosave, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [isDirty, locked, autosave]);

  // Connection back, or the phone about to sleep: save now.
  useEffect(() => {
    if (!isDirty || locked) return;
    const onOnline = () => void autosave();
    const onHide = () => {
      if (document.visibilityState === "hidden") void autosave();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [isDirty, locked, autosave]);

  // Warn the examiner before closing the tab when there are unsaved
  // changes — the bridge case the user flagged where an exam halts and
  // they need confidence their work is recoverable.
  useEffect(() => {
    if (!isDirty || locked) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Some browsers (Safari) only show the prompt if returnValue is set.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty, locked]);

  async function save(final: boolean, allowIncomplete = false) {
    setBusy(final ? "submit" : "draft");
    busyRef.current = true;
    const res = await patchJson<SubmitResult>(`/api/exams/${examId}/score`, body(final, allowIncomplete));
    busyRef.current = false;
    setBusy(null);
    if (!res.ok) {
      if (res.status === 0) {
        setSync("offline");
        toast.error("No connection — your marks are kept on this phone and will save when you're back online.");
        return;
      }
      // Submitting a partially-filled card is irreversible and scores the
      // blanks as zero, so make the examiner say so out loud rather than
      // discovering it after the parents have been notified.
      if (res.code === "INCOMPLETE_CARD") {
        const d = res.data as { unscored?: number; itemCount?: number };
        const ok = await openConfirm({
          title: `Submit with ${d.unscored} item${d.unscored === 1 ? "" : "s"} unscored?`,
          body:
            `${d.unscored} of ${d.itemCount} rubric items have no score, and unscored items count as zero — ` +
            `so the rider will be recorded lower than they earned. Your card locks once submitted, ` +
            `and when the whole jury is in the result is sent to the rider and their parents.`,
          destructive: true,
          confirmLabel: "Submit anyway",
        });
        if (ok) await save(final, true);
        return;
      }
      toast.error(res.message);
      return;
    }
    setSavedSnapshot({ scores: { ...scores }, deductions, timeFaults });
    setLastSavedAt(new Date());
    setSync("idle");
    setRestoredAt(null);
    clearLocal(cardKey);
    if (final) {
      if (res.data.completed === false) {
        const names = res.data.waitingFor ?? [];
        toast.success(
          names.length > 0
            ? `Your card is submitted. Waiting for ${names.join(", ")} to submit theirs.`
            : "Your card is submitted.",
        );
        router.refresh();
        return;
      }
      toast.success(
        res.data.passed === true ? "Submitted — pass" : res.data.passed === false ? "Submitted — fail" : "Submitted",
      );
      router.push("/exams");
    } else {
      toast.success("Draft saved — you can close this tab and come back anytime");
    }
    router.refresh();
  }

  async function reset() {
    const ok = await openConfirm({
      title: "Reset this draft?",
      body: judgeId
        ? "All the marks on your card will be cleared."
        : "All saved scores will be cleared and the exam will go back to scheduled.",
      destructive: true,
      confirmLabel: "Reset draft",
    });
    if (!ok) return;
    setBusy("reset");
    const res = await deleteJson(`/api/exams/${examId}/score`, judgeId ? { judgeId } : undefined);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Draft reset");
    clearLocal(cardKey);
    setRestoredAt(null);
    setScores({});
    setTotal(0);
    setSavedSnapshot({ scores: {}, deductions, timeFaults });
    setLastSavedAt(null);
    setEngineInitial({});
    setEngineKey((k) => k + 1);
    router.refresh();
  }

  function discardRestored() {
    clearLocal(cardKey);
    setRestoredAt(null);
    setEngineInitial(savedSnapshot.scores);
    setScores(savedSnapshot.scores);
    setDeductions(savedSnapshot.deductions);
    setTimeFaults(savedSnapshot.timeFaults);
    setEngineKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      {restoredAt && !locked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm" role="status">
          <span>
            Put back marks this phone kept at{" "}
            {new Date(restoredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} that hadn&rsquo;t
            reached the server. They save by themselves, or press Save draft.
          </span>
          <Button size="sm" variant="ghost" onClick={discardRestored}>
            Discard them
          </Button>
        </div>
      )}
      <ScoringEngine
        key={engineKey}
        rubricConfig={rubric}
        initialScores={engineInitial}
        readOnly={locked}
        onScoreChange={(s, t) => {
          setScores(s);
          setTotal(t);
        }}
      />

      {canEditAdjustments && !locked && (
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

      {/* On a phone this bar sat over the marks being tapped and took 37% of
          the screen (312px). It is now one status line + one row of buttons
          there; the breakdown and the tip only show on wider screens. */}
      <div className="sticky bottom-2 space-y-2 rounded-lg border bg-card p-2.5 shadow-lg sm:bottom-4 sm:p-4">
        {!locked && (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1 text-[11px]">
            {isDirty && sync === "offline" ? (
              <span className="font-semibold text-amber-700">● Offline — kept on this phone</span>
            ) : isDirty && sync === "saving" ? (
              <span className="text-muted-foreground">Saving…</span>
            ) : isDirty && sync === "error" ? (
              <span className="font-semibold text-destructive">● Couldn&rsquo;t save — press Save draft</span>
            ) : isDirty ? (
              <span className="font-semibold text-amber-700">● Unsaved changes</span>
            ) : lastSavedAt ? (
              <span className="text-emerald-700">✓ Saved</span>
            ) : (
              <span className="text-muted-foreground">No draft saved yet</span>
            )}
            <span className="flex items-center gap-2">
              {lastSavedAt && (
                <span className="font-mono text-muted-foreground">
                  {lastSavedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              <span className="text-sm font-bold text-primary sm:hidden">Total {adjusted}</span>
            </span>
          </div>
        )}

        <div className={`${locked ? "flex" : "hidden sm:flex"} items-center justify-between text-sm`}>
          <span className="text-muted-foreground">Rubric subtotal</span>
          <span className="font-mono">{total}</span>
        </div>
        {(deductions > 0 || timeFaults > 0) && (
          <div className="hidden items-center justify-between text-xs text-muted-foreground sm:flex">
            <span>
              − deductions {deductions} − time faults {timeFaults}
            </span>
            <span className="font-mono">{adjusted}</span>
          </div>
        )}
        <div className={`${locked ? "flex" : "hidden sm:flex"} items-center justify-between text-sm`}>
          <span className="text-muted-foreground">Adjusted total</span>
          <span className="text-xl font-bold text-primary">{adjusted}</span>
        </div>
        <div className={`${locked ? "block" : "hidden sm:block"} text-xs text-muted-foreground`}>Pass mark: {passThreshold}%</div>

        {!locked && (
          <p className="hidden rounded border border-dashed bg-muted/10 px-2 py-1 text-[11px] text-muted-foreground sm:block">
            <b>Tip:</b> Click <b>Save draft</b> anytime — if the exam is paused or you need to step away,
            your scores are kept and you can come back to continue here.
          </p>
        )}

        {!locked && (
          // pr-14 on phones keeps Submit clear of the floating menu button
          // that sits in the bottom-right corner below md.
          <div className={`grid gap-2 pr-14 md:pr-0 ${hasSavedMarks ? "grid-cols-[auto_1fr_1.4fr]" : "grid-cols-[1fr_1.4fr]"} sm:grid-cols-3`}>
            {hasSavedMarks && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={reset}
                aria-label="Reset draft"
                className="border-destructive/40 px-3 text-destructive"
              >
                <RotateCcw className="h-4 w-4" />
                <span className="hidden sm:inline">{busy === "reset" ? "Resetting…" : "Reset draft"}</span>
              </Button>
            )}
            <Button variant="outline" disabled={busy !== null} onClick={() => save(false)} aria-label="Save draft">
              <FileEdit className="h-4 w-4" />
              <span className="sm:hidden">{busy === "draft" ? "Saving…" : "Draft"}</span>
              <span className="hidden sm:inline">{busy === "draft" ? "Saving…" : "Save draft"}</span>
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() => save(true)}
              aria-label={`Lock & submit L${level}`}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Save className="h-4 w-4" />
              <span className="sm:hidden">{busy === "submit" ? "Submitting…" : "Submit"}</span>
              <span className="hidden sm:inline">{busy === "submit" ? "Submitting…" : `Lock & submit L${level}`}</span>
            </Button>
          </div>
        )}
        {cardSubmitted && !isCompleted && (
          <div className="rounded-md border bg-muted p-3 text-center text-sm">
            <div className="font-medium">Your card is submitted and locked</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {waitingFor.length > 0
                ? `The result is worked out once every judge has submitted. Still waiting for: ${waitingFor.join(", ")}.`
                : "The result is worked out once every judge has submitted."}
            </div>
          </div>
        )}
        {isCompleted && (
          <div className="rounded-md border bg-muted p-3 text-center text-sm">
            <div className="font-medium">Submitted and locked</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {canReopen
                ? "If a mark is wrong, reopen the exam for correction below. Every judge's card unlocks with their marks kept."
                : "Scores can’t be changed after submission. If this result is wrong, ask a centre manager to reopen the exam for correction."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
