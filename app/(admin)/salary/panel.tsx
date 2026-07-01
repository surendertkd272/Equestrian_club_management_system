"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { STATUS_LABEL } from "@/lib/schemas/payroll";
import { roleLabel } from "@/lib/labels";
type Staff = { id: string; name: string; role: string };
type Preview = {
  gross: number;
  attendanceDeducted: number;
  absentDays: number;
  breakdown: { status: string; days: number; rate: number; amount: number }[];
  advanceOutstanding: number;
};

export function SalaryPanel({ staff, defaultMonth }: { staff: Staff[]; defaultMonth: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [form, setForm] = useState({
    userId: staff[0]?.id ?? "",
    periodMonth: defaultMonth,
    otherDeductions: "",
    advanceDeduction: "",
    grossOverride: "",
    method: "bank",
    paid: false,
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Pull the computed gross / attendance / advance whenever staff or month changes.
  useEffect(() => {
    if (!form.userId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(form.periodMonth)) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    fetch(`/api/salary/preview?userId=${form.userId}&month=${form.periodMonth}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setPreview(d?.error ? null : d);
      })
      .catch(() => !cancelled && setPreview(null))
      .finally(() => !cancelled && setLoadingPreview(false));
    return () => {
      cancelled = true;
    };
  }, [form.userId, form.periodMonth]);

  const gross = form.grossOverride ? Number(form.grossOverride) : preview?.gross ?? 0;
  const attendanceDed = preview?.attendanceDeducted ?? 0;
  const other = Number(form.otherDeductions) || 0;
  const advanceRequested = Number(form.advanceDeduction) || 0;
  // Mirror the server's recovery cap (app/api/salary/route.ts): you can't
  // recover more advance than is outstanding, nor more than the take-home left
  // after attendance + other deductions. Without this the preview promised a
  // lower net than the server actually recorded when the user over-typed the
  // advance.
  const takeHomeBeforeAdvance = Math.max(0, gross - attendanceDed - other);
  const advance = Math.min(advanceRequested, preview?.advanceOutstanding ?? advanceRequested, takeHomeBeforeAdvance);
  const advanceCapped = advance < advanceRequested;
  const net = Math.max(0, takeHomeBeforeAdvance - advance);

  async function submit() {
    if (!form.userId) return toast.error("Pick a staff member.");
    if (gross <= 0) return toast.error("No salary set for this staff member — set it in the structure table above.");
    setBusy(true);
    try {
      const res = await fetch("/api/salary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: form.userId,
          periodMonth: form.periodMonth,
          otherDeductions: other,
          advanceDeduction: advance,
          grossOverride: form.grossOverride ? Number(form.grossOverride) : undefined,
          method: form.method,
          paid: form.paid,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.error === "ALREADY_RECORDED" ? `Salary for ${form.periodMonth} is already recorded.`
          : data.error === "NO_SALARY_STRUCTURE" ? "No salary set for this staff member yet."
          : data.error ?? "Failed",
        );
        return;
      }
      toast.success(`Recorded · net ₹${Math.round(data.netAmount).toLocaleString("en-IN")}`);
      setForm((f) => ({ ...f, otherDeductions: "", advanceDeduction: "", grossOverride: "" }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Record a Salary Payment</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Staff member</Label>
            <Select aria-label="Staff member" value={form.userId} onChange={(e) => set("userId", e.target.value)}>
              {staff.length === 0 && <option value="">(no staff)</option>}
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {roleLabel(s.role)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Month</Label>
            <Input aria-label="Month" type="month" value={form.periodMonth} onChange={(e) => set("periodMonth", e.target.value)} />
          </div>
          <div>
            <Label>Gross override (₹, optional)</Label>
            <Input aria-label="Gross override (₹, optional)"
              type="number"
              value={form.grossOverride}
              onChange={(e) => set("grossOverride", e.target.value)}
              placeholder={preview ? String(Math.round(preview.gross)) : "from structure"}
            />
          </div>
          <div>
            <Label>Advance to deduct (₹)</Label>
            <Input aria-label="Advance to deduct (₹)"
              type="number"
              value={form.advanceDeduction}
              onChange={(e) => set("advanceDeduction", e.target.value)}
              placeholder="0"
            />
            {preview && preview.advanceOutstanding > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                Outstanding advance: ₹{Math.round(preview.advanceOutstanding).toLocaleString("en-IN")}
                {" · "}
                <button type="button" className="underline" onClick={() => set("advanceDeduction", String(Math.round(preview.advanceOutstanding)))}>
                  deduct all
                </button>
              </p>
            )}
          </div>
          <div>
            <Label>Other deductions (₹)</Label>
            <Input aria-label="Other deductions (₹)" type="number" value={form.otherDeductions} onChange={(e) => set("otherDeductions", e.target.value)} placeholder="0" />
          </div>
          <div>
            <Label>Method</Label>
            <Select aria-label="Method" value={form.method} onChange={(e) => set("method", e.target.value)}>
              <option value="bank">Bank Transfer</option>
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
            </Select>
          </div>
        </div>

        {/* Computed breakdown */}
        <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
          {loadingPreview ? (
            <span className="text-muted-foreground">Computing…</span>
          ) : !preview ? (
            <span className="text-muted-foreground">Pick a staff member + month to compute.</span>
          ) : preview.gross <= 0 && !form.grossOverride ? (
            <span className="text-amber-700">No salary set for this staff member — set it in the structure table above.</span>
          ) : (
            <div className="space-y-1">
              <Line label="Gross Salary" value={gross} />
              {preview.breakdown.map((b) => (
                <Line
                  key={b.status}
                  label={`− ${STATUS_LABEL[b.status] ?? b.status} (${b.days} × ₹${Math.round(b.rate).toLocaleString("en-IN")})`}
                  value={-b.amount}
                  tone="amber"
                />
              ))}
              {advance > 0 && <Line label={`− Advance recovery${advanceCapped ? " (capped)" : ""}`} value={-advance} tone="amber" />}
              {advanceCapped && (
                <p className="text-[11px] text-amber-700">
                  Advance capped to ₹{Math.round(advance).toLocaleString("en-IN")} — limited by what's outstanding and the take-home pay.
                </p>
              )}
              {other > 0 && <Line label="− Other Deductions" value={-other} tone="amber" />}
              <div className="mt-1 border-t pt-1">
                <Line label="Net Payable" value={net} bold />
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.paid} onChange={(e) => set("paid", e.target.checked)} />
            Mark as paid now
          </label>
          <Button onClick={submit} disabled={busy || staff.length === 0}>
            {busy ? "Recording…" : "Record salary"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Line({ label, value, tone, bold }: { label: string; value: number; tone?: "amber"; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${bold ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
      <span className={`font-mono ${tone === "amber" ? "text-amber-700" : ""} ${bold ? "text-base font-semibold" : ""}`}>
        {value < 0 ? "−" : ""}₹{Math.abs(Math.round(value)).toLocaleString("en-IN")}
      </span>
    </div>
  );
}
