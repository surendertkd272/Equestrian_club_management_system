"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { postJson, deleteJson } from "@/lib/client/post-json";
import { X } from "lucide-react";

// Seat judges on the sitting's jury panel (co-judges on every rider), or take
// one off. The rules — eligibility, not in the claim pool, access dates —
// live in /api/exam-sittings/[id]/panel.
export function PanelEditor({
  sittingId,
  panel,
  candidates,
}: {
  sittingId: string;
  panel: { id: string; name: string }[];
  candidates: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!pick) return;
    setBusy(true);
    const res = await postJson<{ cardsSeated: number }>(`/api/exam-sittings/${sittingId}/panel`, { judgeIds: [pick] });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(`Seated on ${res.data.cardsSeated} rider${res.data.cardsSeated === 1 ? "" : "s"} still to be marked`);
    setPick("");
    router.refresh();
  }

  async function remove(j: { id: string; name: string }) {
    const ok = await openConfirm({
      title: `Take ${j.name} off the panel?`,
      body: "Their cards still to be marked come off every rider. Cards they already submitted stay — those marks stand.",
      confirmLabel: "Take off panel",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await deleteJson<{ cardsRemoved: number; examsCompleted: number }>(`/api/exam-sittings/${sittingId}/panel`, {
      judgeId: j.id,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(
      `${j.name} is off the panel` +
        (res.data.examsCompleted ? ` · ${res.data.examsCompleted} exam${res.data.examsCompleted === 1 ? "" : "s"} completed` : ""),
    );
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {panel.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {panel.map((j) => (
            <span key={j.id} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold">
              {j.name}
              <button
                type="button"
                onClick={() => remove(j)}
                disabled={busy}
                aria-label={`Take ${j.name} off the panel`}
                className="rounded-full p-0.5 hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {candidates.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Judge to seat on the panel" value={pick} onChange={(e) => setPick(e.target.value)} className="max-w-full sm:w-72">
            <option value="">Add a judge to the panel…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={add} disabled={!pick || busy}>
            {busy ? "Seating…" : "Seat on every rider"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No other judges available for this centre.</p>
      )}
    </div>
  );
}

// Add or take out the examiners who pick riders from the sitting's queue.
// Riders an examiner picked but hasn't started go back to the queue; ones
// they've started marking must be handed on first (the API says so).
export function PoolEditor({
  sittingId,
  pool,
  candidates,
}: {
  sittingId: string;
  pool: { id: string; name: string }[];
  candidates: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!pick) return;
    setBusy(true);
    const res = await postJson(`/api/exam-sittings/${sittingId}/examiners`, { examinerIds: [pick] });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success("Examiner added to the pool");
    setPick("");
    router.refresh();
  }

  async function remove(j: { id: string; name: string }) {
    const ok = await openConfirm({
      title: `Take ${j.name} out of the pool?`,
      body: "Riders they picked but haven't started marking go back to the queue.",
      confirmLabel: "Take out",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await deleteJson<{ ridersReleased: number }>(`/api/exam-sittings/${sittingId}/examiners`, { examinerId: j.id });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(
      `${j.name} is out of the pool` +
        (res.data.ridersReleased ? ` · ${res.data.ridersReleased} rider${res.data.ridersReleased === 1 ? "" : "s"} back in the queue` : ""),
    );
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {pool.map((j) => (
          <span key={j.id} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold">
            {j.name}
            <button
              type="button"
              onClick={() => remove(j)}
              disabled={busy}
              aria-label={`Take ${j.name} out of the pool`}
              className="rounded-full p-0.5 hover:bg-muted"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Examiner to add to the pool" value={pick} onChange={(e) => setPick(e.target.value)} className="max-w-full sm:w-72">
            <option value="">Add an examiner…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={add} disabled={!pick || busy}>
            Add to pool
          </Button>
        </div>
      )}
    </div>
  );
}
