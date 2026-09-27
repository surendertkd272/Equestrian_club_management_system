"use client";

// Manager controls for the exam schedule and for correcting a result:
// reopen a completed exam, move an exam or a whole sitting, take a rider off
// the schedule, cancel a sitting. The rules live server-side
// (/api/exams/[id], /api/exams/[id]/reopen, /api/exam-sittings/[id]); these
// only collect intent and confirmation.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { postJson, patchJson, deleteJson, type JsonResult } from "@/lib/client/post-json";
import { CalendarClock, RotateCcw, Trash2, XCircle } from "lucide-react";

const inputCls = "mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";

// DELETE that refuses once with HAS_MARKS when marks/attachments exist, then
// retries with discardMarks after the user has confirmed that specifically.
async function deleteWithMarksCheck<T>(url: string): Promise<JsonResult<T> | null> {
  const first = await deleteJson<T>(url, {});
  if (first.ok || first.code !== "HAS_MARKS") return first;
  const ok = await openConfirm({
    title: "Discard saved marks?",
    body: "Marks or attachments have already been saved. They will be deleted and can't be recovered.",
    destructive: true,
    confirmLabel: "Discard and remove",
  });
  if (!ok) return null;
  return deleteJson<T>(url, { discardMarks: true });
}

export function ReopenExamButton({ examId }: { examId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await postJson(`/api/exams/${examId}/reopen`, { reason });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Exam reopened — the jury's cards are unlocked for correction");
    setOpen(false);
    setReason("");
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RotateCcw className="h-4 w-4" /> Reopen for correction
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-md border bg-card p-3">
      <label className="block text-sm">
        <span className="font-medium">Why does this result need correcting?</span>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="e.g. Examiner entered Trot marks on the wrong rider's card"
          className={inputCls}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Every judge&rsquo;s card unlocks with its marks kept. The result, and any certificate, stays as it is until the
        corrected cards are submitted again — then a certificate is kept for a pass or revoked if it is no longer one.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={busy || reason.trim().length < 5}>
          {busy ? "Reopening…" : "Reopen exam"}
        </Button>
      </div>
    </div>
  );
}

// Move a single exam, or a whole sitting, to a new date / start time.
export function RescheduleForm({
  url,
  initialDate,
  initialTime,
  label,
}: {
  url: string;
  initialDate: string;
  initialTime: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await patchJson<{ examsMoved?: number }>(url, {
      ...(date !== initialDate ? { date } : {}),
      ...(time !== initialTime ? { time } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(
      typeof res.data.examsMoved === "number"
        ? `Moved ${res.data.examsMoved} rider${res.data.examsMoved === 1 ? "" : "s"}`
        : "Rescheduled",
    );
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="h-4 w-4" /> {label}
      </Button>
    );
  }
  const unchanged = date === initialDate && time === initialTime;
  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-md border bg-card p-3">
      <label className="text-sm">
        <span className="text-xs text-muted-foreground">Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
      </label>
      <label className="text-sm">
        <span className="text-xs text-muted-foreground">Start time</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
      </label>
      <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </Button>
      <Button size="sm" onClick={submit} disabled={busy || unchanged || !date || !time}>
        {busy ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

// Take one rider's exam off the schedule. Used on the exam page and on each
// row of a sitting.
export function RemoveExamButton({
  examId,
  riderName,
  inSitting,
  afterRemove,
  compact = false,
}: {
  examId: string;
  riderName: string;
  inSitting: boolean;
  // Where to go once removed; omitted → stay and refresh (sitting rows).
  afterRemove?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    const ok = await openConfirm({
      title: inSitting ? `Remove ${riderName} from this sitting?` : `Remove ${riderName}'s exam?`,
      body: "The exam comes off the schedule and the examiners' queue. You can book the rider again later.",
      destructive: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    setBusy(true);
    const res = await deleteWithMarksCheck<{ sittingRemoved?: string | null }>(`/api/exams/${examId}`);
    setBusy(false);
    if (!res) return;
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Removed from the schedule");
    // The last rider out of a sitting removes the sitting too.
    if (res.data.sittingRemoved) router.push("/exams");
    else if (afterRemove) router.push(afterRemove);
    else router.refresh();
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={remove}
      disabled={busy}
      className="border-destructive/40 text-destructive"
      aria-label={`Remove ${riderName}`}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {!compact && (busy ? "Removing…" : inSitting ? "Remove from sitting" : "Remove exam")}
    </Button>
  );
}

export function CancelSittingButton({
  sittingId,
  waiting,
  withResults,
}: {
  sittingId: string;
  waiting: number;
  withResults: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    const ok = await openConfirm({
      title: "Cancel this sitting?",
      body:
        `${waiting} rider${waiting === 1 ? "" : "s"} still waiting will be taken off the schedule.` +
        (withResults > 0
          ? ` ${withResults} rider${withResults === 1 ? " who has" : "s who have"} a result stay on record, and so does the sitting.`
          : ""),
      destructive: true,
      confirmLabel: "Cancel sitting",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    setBusy(true);
    const res = await deleteWithMarksCheck<{ removed: number; sittingRemoved: boolean }>(
      `/api/exam-sittings/${sittingId}`,
    );
    setBusy(false);
    if (!res) return;
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`Removed ${res.data.removed} rider${res.data.removed === 1 ? "" : "s"} from the schedule`);
    if (res.data.sittingRemoved) router.push("/exams");
    else router.refresh();
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={cancel}
      disabled={busy || waiting === 0}
      className="border-destructive/40 text-destructive"
    >
      <XCircle className="h-4 w-4" /> {busy ? "Cancelling…" : "Cancel sitting"}
    </Button>
  );
}
