"use client";

// Off-board a rider, and bring one back.
//
// The screen the product never had. A family that leaves had no exit: the
// child stayed "active", on the roster, in the headcount, in the fee chase.
// The two decisions an operator actually has to make when someone leaves are
// both surfaced here rather than assumed — when their last day was, and what
// happens to the money they still owe.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postJson } from "@/lib/client/post-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LogOut, Undo2 } from "lucide-react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { openConfirm } from "@/components/ui/confirm-dialog";

export function WithdrawPanel({
  riderId,
  riderName,
  status,
  outstanding,
  batchName,
}: {
  riderId: string;
  riderName: string;
  status: string;
  /** What the family still owes across all live invoices, in INR. */
  outstanding: number;
  batchName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [lastDay, setLastDay] = useState("");
  const [cancelOutstanding, setCancelOutstanding] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  useFocusTrap(dialogRef, open);

  // The withdrawn state renders as a full-width banner (WithdrawnRiderBanner),
  // not from here — this component is only the action.
  if (status === "withdrawn") return null;

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      toast.error("Say why they're leaving — it goes on the record.");
      return;
    }
    setBusy(true);
    const res = await postJson(`/api/riders/${riderId}/withdraw`, {
      reason: reason.trim(),
      ...(lastDay ? { lastDayAt: lastDay } : {}),
      cancelOutstanding,
      clearBatch: true,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    const d = res.data as { duesCancelled?: number; outstandingAfter?: number };
    toast.success(
      d.duesCancelled && d.duesCancelled > 0.5
        ? `${riderName} off-boarded · ₹${Math.round(d.duesCancelled).toLocaleString("en-IN")} of dues cancelled`
        : d.outstandingAfter && d.outstandingAfter > 0.5
          ? `${riderName} off-boarded · ₹${Math.round(d.outstandingAfter).toLocaleString("en-IN")} still to collect`
          : `${riderName} off-boarded`,
    );
    setOpen(false);
    setReason("");
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut className="mr-1 h-3 w-3" /> Off-board
      </Button>
      {open && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <form
            ref={dialogRef}
            onSubmit={withdraw}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Off-board ${riderName}`}
            tabIndex={-1}
            className="absolute left-1/2 top-[8%] z-50 max-h-[84vh] w-full max-w-md -translate-x-1/2 space-y-3 overflow-y-auto rounded-lg border bg-card p-4 text-left shadow-xl outline-none"
          >
            <h2 className="text-base font-semibold">Off-board {riderName}</h2>
            <p className="text-xs text-muted-foreground">
              They come off the roster{batchName ? ` and out of ${batchName}` : ""} and stop counting towards active
              riders. Nothing is deleted — attendance, invoices, certificates and exam history stay, and you can bring
              them back later.
            </p>

            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Textarea
                aria-label="Reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Moved city / stopping riding / switched to another club"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label>Last day (optional)</Label>
              <Input
                aria-label="Last day"
                type="date"
                value={lastDay}
                onChange={(e) => setLastDay(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Their actual last day, if it wasn&apos;t today — families usually tell you weeks later.
              </p>
            </div>

            {outstanding > 0.5 ? (
              <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  ₹{Math.round(outstanding).toLocaleString("en-IN")} still outstanding
                </p>
                <label className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={cancelOutstanding}
                    onChange={(e) => setCancelOutstanding(e.target.checked)}
                  />
                  <span>
                    Cancel it — issue credit notes so the family stops being chased. Leave unticked if you still intend
                    to collect for lessons already taken.
                  </span>
                </label>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nothing outstanding on their account.</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || reason.trim().length < 3}>
                {busy ? "Saving…" : "Off-board"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

// The notice shown across the top of a withdrawn rider's profile, with the way
// back. Separate from the action above so the profile can put the button in
// the header row and the notice full-width where it can't be missed.
export function WithdrawnRiderBanner({
  riderId,
  riderName,
  withdrawnAt,
  withdrawalReason,
  lastDayAt,
  outstanding,
  canManage,
}: {
  riderId: string;
  riderName: string;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  lastDayAt: string | null;
  outstanding: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function rejoin() {
    const ok = await openConfirm({
      title: `Bring ${riderName} back?`,
      body:
        "Their enrolment reopens and they return to the rider list. Any dues cancelled on withdrawal stay cancelled, and they'll need assigning to a batch before they appear on a roster.",
      confirmLabel: "Re-activate",
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/riders/${riderId}/withdraw`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(data.message ?? data.error ?? "Couldn't re-activate");
      return;
    }
    toast.success(data.message ?? "Rider re-activated");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-medium">
            Off-boarded
            {lastDayAt
              ? ` — last day ${new Date(lastDayAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}`
              : ""}
            {withdrawnAt
              ? ` · recorded ${new Date(withdrawnAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}`
              : ""}
          </p>
          {withdrawalReason && <p>&ldquo;{withdrawalReason}&rdquo;</p>}
          {outstanding > 0.5 && (
            <p>
              &#8377;{Math.round(outstanding).toLocaleString("en-IN")} was left outstanding and is still on the books.
            </p>
          )}
          <p className="text-xs opacity-80">
            Attendance, invoices, certificates and exam history are all kept.
          </p>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={rejoin} disabled={busy}>
            <Undo2 className="mr-1 h-3 w-3" /> Bring them back
          </Button>
        )}
      </div>
    </div>
  );
}
