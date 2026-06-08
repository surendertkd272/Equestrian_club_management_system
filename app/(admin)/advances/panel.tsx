"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, IndianRupee } from "lucide-react";
import { formatDate } from "@/lib/utils";

type Repayment = { id: string; amount: number; deductedAt: string; notes: string | null };
type AdvanceRow = {
  id: string;
  amount: number;
  paid: number;
  remaining: number;
  status: string;
  reason: string;
  notes: string | null;
  givenAt: string;
  user: { id: string; name: string; role: string };
  repayments: Repayment[];
};

export function AdvancesPanel({
  rows,
  eligibleUsers,
}: {
  rows: AdvanceRow[];
  eligibleUsers: { id: string; name: string; role: string }[];
}) {
  const router = useRouter();
  const [openIssue, setOpenIssue] = useState(false);
  const [issuingFor, setIssuingFor] = useState(eligibleUsers[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (!issuingFor) return toast.error("Pick a recipient.");
    if (Number(amount) <= 0) return toast.error("Amount must be positive.");
    setBusy(true);
    const res = await fetch("/api/advances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: issuingFor,
        amount: Number(amount),
        reason: reason.trim(),
        notes: notes.trim() || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed");
      return;
    }
    toast.success("Advance recorded");
    setAmount(""); setReason(""); setNotes("");
    setOpenIssue(false);
    router.refresh();
  }

  const outstanding = rows.filter((r) => r.status !== "repaid" && r.status !== "written_off");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Outstanding ({outstanding.length})</CardTitle>
          {!openIssue && (
            <Button size="sm" onClick={() => setOpenIssue(true)}>
              <Plus className="mr-1 h-4 w-4" /> Issue advance
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {openIssue && (
          <form onSubmit={issue} className="space-y-3 rounded-md border bg-muted/40 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Recipient *</Label>
                <Select aria-label="Recipient" value={issuingFor} onChange={(e) => setIssuingFor(e.target.value)}>
                  <option value="">— pick —</option>
                  {eligibleUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.role.replaceAll("_", " ").toLowerCase()}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount (₹) *</Label>
                <Input
                  type="number"
                  // step="any" — no value grid, so the field keeps exactly what's
                  // typed. A previous step="100" snapped the spinner/validation to
                  // round hundreds (2000 → 2001 with the old min={1}); "any" removes
                  // that class of bug entirely. min={0} keeps it non-negative.
                  min={0}
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Reason *</Label>
                <Input aria-label="Reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  placeholder="School fees, medical, festival, etc."
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Notes</Label>
                <Input aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpenIssue(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Issuing…" : "Record advance"}
              </Button>
            </div>
          </form>
        )}

        {outstanding.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No outstanding advances.</p>
        ) : (
          <ol className="space-y-3">
            {outstanding.map((row) => (
              <AdvanceRowDisplay key={row.id} row={row} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function AdvanceRowDisplay({ row }: { row: AdvanceRow }) {
  const router = useRouter();
  const [openRepay, setOpenRepay] = useState(false);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayNotes, setRepayNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function repay(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(repayAmount);
    if (amt <= 0) return toast.error("Amount must be positive.");
    if (amt > row.remaining + 0.01) return toast.error("Cannot exceed remaining balance.");
    setBusy(true);
    const res = await fetch(`/api/advances/${row.id}/repay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amt, notes: repayNotes.trim() || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed");
      return;
    }
    toast.success("Repayment recorded");
    setOpenRepay(false);
    setRepayAmount(""); setRepayNotes("");
    router.refresh();
  }

  return (
    <li className="rounded-md border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold">{row.user.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{row.user.role.replaceAll("_", " ")}</span>
          <Badge variant={row.status === "outstanding" ? "warning" : "outline"} className="ml-2">
            {row.status.replaceAll("_", " ")}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-mono">Issued ₹{Math.round(row.amount).toLocaleString("en-IN")}</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono">Paid ₹{Math.round(row.paid).toLocaleString("en-IN")}</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono font-semibold">Remaining ₹{Math.round(row.remaining).toLocaleString("en-IN")}</span>
        </div>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {row.reason} · given {formatDate(new Date(row.givenAt))}
      </div>

      {row.repayments.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {row.repayments.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-t pt-1 text-xs text-muted-foreground">
              <span>{formatDate(new Date(r.deductedAt))} · {r.notes ?? "salary deduction"}</span>
              <span className="font-mono">−₹{Math.round(r.amount).toLocaleString("en-IN")}</span>
            </div>
          ))}
        </div>
      )}

      {!openRepay ? (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpenRepay(true)}>
          <IndianRupee className="mr-1 h-3 w-3" /> Record repayment
        </Button>
      ) : (
        <form onSubmit={repay} className="mt-2 flex flex-wrap items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Amount (max ₹{Math.round(row.remaining).toLocaleString("en-IN")})</Label>
            <Input
              type="number"
              // step="any" so the exact amount is kept (no round-hundred grid) —
              // also lets you repay a fractional remaining balance exactly.
              min={0}
              max={row.remaining}
              step="any"
              value={repayAmount}
              onChange={(e) => setRepayAmount(e.target.value)}
              required
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Notes</Label>
            <Input aria-label="Notes"
              value={repayNotes}
              onChange={(e) => setRepayNotes(e.target.value)}
              placeholder="Apr salary"
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpenRepay(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Deduct"}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
