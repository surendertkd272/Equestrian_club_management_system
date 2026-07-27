"use client";

// The reverse gear, on the screen.
//
// Void, credit note, payment reversal and payroll void all shipped as working
// endpoints with nothing calling them — which is the same write-only-feature
// failure this product has been bitten by before. An API an operator cannot
// reach has not fixed their problem; they still ring the accountant.
//
// All four share one small prompt-and-confirm shape, because all four are the
// same conversation: "say why, and I'll record it."

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFocusTrap } from "@/lib/use-focus-trap";

function money(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** Shared modal shell so the four actions look and behave identically. */
function ActionDialog({
  title,
  intro,
  confirmLabel,
  busy,
  onClose,
  onConfirm,
  disabled,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  confirmLabel: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  useFocusTrap(ref, true);
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <form
        ref={ref}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute left-1/2 top-[10%] z-50 max-h-[80vh] w-full max-w-md -translate-x-1/2 space-y-3 overflow-y-auto rounded-lg border bg-card p-4 text-left shadow-xl outline-none"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="text-xs text-muted-foreground">{intro}</div>
        {children}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || disabled}>
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data, message: (data.message as string) ?? (data.error as string) ?? "Failed" };
}

// ── Invoice: void, or credit ────────────────────────────────────────────────

export function InvoiceReversalActions({
  invoiceId,
  outstanding,
  received,
  voided,
  isCreditNote,
}: {
  invoiceId: string;
  /** What is still collectable on this invoice, in INR. */
  outstanding: number;
  /** Payments received against it, net of reversals. */
  received: number;
  voided: boolean;
  isCreditNote: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "void" | "credit">(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");

  // Nothing to reverse on a credit note or an already-void invoice.
  if (voided || isCreditNote) return null;

  function close() {
    setReason("");
    setAmount("");
    setMode(null);
  }

  async function go() {
    if (reason.trim().length < 3) {
      toast.error("Say why — it goes on the record.");
      return;
    }
    setBusy(true);
    const res =
      mode === "void"
        ? await post(`/api/invoices/${invoiceId}/void`, { reason: reason.trim() })
        : await post(`/api/invoices/${invoiceId}/credit-note`, {
            reason: reason.trim(),
            ...(amount ? { amount: Number(amount) } : {}),
          });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(
      mode === "void"
        ? "Invoice voided"
        : `${money((res.data.amount as number) ?? 0)} credited`,
    );
    close();
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {/* Void is only honest while no money has been taken; past that the
            instrument is a credit note, and the API says so too. */}
        {received <= 0.001 && (
          <button
            type="button"
            onClick={() => setMode("void")}
            className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
            title="Cancel an invoice raised in error"
          >
            Void
          </button>
        )}
        <button
          type="button"
          onClick={() => setMode("credit")}
          className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
          title="Cancel what is still owed, or refund what was paid"
        >
          Credit note
        </button>
      </div>

      {mode === "void" && (
        <ActionDialog
          title="Void this invoice"
          intro="For a charge raised in error. The invoice stays on the ledger marked void, with your reason, and stops being collectable."
          confirmLabel="Void invoice"
          busy={busy}
          onClose={close}
          onConfirm={go}
          disabled={reason.trim().length < 3}
        >
          <div className="space-y-1.5">
            <Label>Reason *</Label>
            <Textarea
              aria-label="Reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Raised against the wrong rider / duplicate of an earlier bill"
              autoFocus
            />
          </div>
        </ActionDialog>
      )}

      {mode === "credit" && (
        <ActionDialog
          title="Issue a credit note"
          intro={
            <>
              Leave the amount blank to cancel the {money(outstanding)} still outstanding — the usual case.
              Enter an amount only if the club intends to refund money already received.
            </>
          }
          confirmLabel="Issue credit note"
          busy={busy}
          onClose={close}
          onConfirm={go}
          disabled={reason.trim().length < 3}
        >
          <div className="space-y-1.5">
            <Label>Amount (₹) — blank cancels the outstanding {money(outstanding)}</Label>
            <Input
              aria-label="Credit amount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(Math.round(outstanding))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reason *</Label>
            <Textarea
              aria-label="Reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Withdrew mid-term / over-billed / goodwill adjustment"
              autoFocus
            />
          </div>
        </ActionDialog>
      )}
    </>
  );
}

// ── Payment: reverse ────────────────────────────────────────────────────────

const REVERSAL_REASONS = [
  { value: "bounced", label: "Cheque bounced" },
  { value: "entered_in_error", label: "Entered in error" },
  { value: "refunded", label: "Refunded to the family" },
  { value: "other", label: "Other" },
] as const;

export function ReversePaymentButton({
  paymentId,
  amount,
  alreadyReversed,
}: {
  paymentId: string;
  amount: number;
  alreadyReversed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<(typeof REVERSAL_REASONS)[number]["value"]>("bounced");
  const [note, setNote] = useState("");

  // A reversal row is itself negative, and a payment can only be undone once.
  if (amount < 0 || alreadyReversed) return null;

  function close() {
    setNote("");
    setReason("bounced");
    setOpen(false);
  }

  async function go() {
    setBusy(true);
    const res = await post(`/api/payments/${paymentId}/reverse`, {
      reason,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`${money(amount)} reversed`);
    close();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
        title="Undo this receipt"
      >
        Reverse
      </button>
      {open && (
        <ActionDialog
          title={`Reverse ${money(amount)}`}
          intro="Records a matching negative entry rather than deleting the receipt, so both halves stay on the ledger and the invoice goes back to owing."
          confirmLabel="Reverse payment"
          busy={busy}
          onClose={close}
          onConfirm={go}
        >
          <div className="space-y-1.5">
            <Label>Why *</Label>
            <Select
              aria-label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              {REVERSAL_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Input
              aria-label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Returned unpaid by bank on 12 Jul"
            />
          </div>
        </ActionDialog>
      )}
    </>
  );
}

// ── Payroll: void a run ─────────────────────────────────────────────────────

export function VoidSalaryButton({
  salaryId,
  employeeName,
  periodMonth,
  net,
  voided,
}: {
  salaryId: string;
  employeeName: string;
  periodMonth: string;
  net: number;
  voided: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  if (voided) return null;

  function close() {
    setReason("");
    setOpen(false);
  }

  async function go() {
    if (reason.trim().length < 3) {
      toast.error("Say why — it goes on the record.");
      return;
    }
    setBusy(true);
    const res = await post(`/api/salary/${salaryId}/void`, { reason: reason.trim() });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    const released = (res.data.advanceReleased as number) ?? 0;
    toast.success(
      released > 0.5
        ? `Run voided · ${money(released)} of advance released back`
        : "Payroll run voided",
    );
    close();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
        title="Void this payroll run"
      >
        Void
      </button>
      {open && (
        <ActionDialog
          title={`Void ${periodMonth} payroll for ${employeeName}`}
          intro={`${money(net)} comes out of the month's cost. The row stays with your reason so the payslip history survives, it drops out of the Tally export, and any advance this run recovered is released back to the employee. You can then record the month again.`}
          confirmLabel="Void run"
          busy={busy}
          onClose={close}
          onConfirm={go}
          disabled={reason.trim().length < 3}
        >
          <div className="space-y-1.5">
            <Label>Reason *</Label>
            <Textarea
              aria-label="Reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Recorded against the wrong month / wrong amount / run twice"
              autoFocus
            />
          </div>
        </ActionDialog>
      )}
    </>
  );
}
