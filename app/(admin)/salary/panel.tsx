"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

type Staff = { id: string; name: string; role: string; outstandingAdvance: number };

export function SalaryPanel({ staff, defaultMonth }: { staff: Staff[]; defaultMonth: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    userId: staff[0]?.id ?? "",
    periodMonth: defaultMonth,
    grossAmount: "",
    otherDeductions: "",
    advanceDeduction: "",
    method: "bank",
    paid: false,
  });

  const selected = useMemo(() => staff.find((s) => s.id === form.userId) ?? null, [staff, form.userId]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const gross = Number(form.grossAmount) || 0;
  const other = Number(form.otherDeductions) || 0;
  const advance = Number(form.advanceDeduction) || 0;
  const net = Math.max(0, gross - other - advance);

  async function submit() {
    if (!form.userId) return toast.error("Pick a staff member.");
    if (gross <= 0) return toast.error("Enter the gross salary.");
    setBusy(true);
    try {
      const res = await fetch("/api/salary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: form.userId,
          periodMonth: form.periodMonth,
          grossAmount: gross,
          otherDeductions: other,
          advanceDeduction: advance,
          method: form.method,
          paid: form.paid,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.error === "ALREADY_RECORDED"
            ? `Salary for ${form.periodMonth} is already recorded for this staff member.`
            : data.error ?? "Failed",
        );
        return;
      }
      toast.success(
        data.advanceDeducted > 0
          ? `Recorded · ₹${Math.round(data.advanceDeducted).toLocaleString("en-IN")} advance deducted · net ₹${Math.round(data.netAmount).toLocaleString("en-IN")}`
          : `Recorded · net ₹${Math.round(data.netAmount).toLocaleString("en-IN")}`,
      );
      setForm((f) => ({ ...f, grossAmount: "", otherDeductions: "", advanceDeduction: "" }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Record a salary payment</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Staff member</Label>
            <Select value={form.userId} onChange={(e) => set("userId", e.target.value)}>
              {staff.length === 0 && <option value="">(no staff)</option>}
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.role.replace(/_/g, " ").toLowerCase()}
                </option>
              ))}
            </Select>
            {selected && selected.outstandingAdvance > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                Outstanding advance: ₹{selected.outstandingAdvance.toLocaleString("en-IN")}
                {" · "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => set("advanceDeduction", String(Math.min(selected.outstandingAdvance, gross - other || selected.outstandingAdvance)))}
                >
                  deduct max
                </button>
              </p>
            )}
          </div>
          <div>
            <Label>Month</Label>
            <Input type="month" value={form.periodMonth} onChange={(e) => set("periodMonth", e.target.value)} />
          </div>
          <div>
            <Label>Gross salary (₹)</Label>
            <Input type="number" value={form.grossAmount} onChange={(e) => set("grossAmount", e.target.value)} placeholder="25000" />
          </div>
          <div>
            <Label>Advance to deduct (₹)</Label>
            <Input
              type="number"
              value={form.advanceDeduction}
              onChange={(e) => set("advanceDeduction", e.target.value)}
              placeholder="0"
              max={selected?.outstandingAdvance ?? undefined}
            />
          </div>
          <div>
            <Label>Other deductions (₹)</Label>
            <Input type="number" value={form.otherDeductions} onChange={(e) => set("otherDeductions", e.target.value)} placeholder="0" />
          </div>
          <div>
            <Label>Method</Label>
            <Select value={form.method} onChange={(e) => set("method", e.target.value)}>
              <option value="bank">Bank transfer</option>
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
          <div className="text-sm">
            Net payable:{" "}
            <span className="text-lg font-semibold">₹{net.toLocaleString("en-IN")}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              = ₹{gross.toLocaleString("en-IN")} − ₹{other.toLocaleString("en-IN")} other − ₹{advance.toLocaleString("en-IN")} advance
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.paid} onChange={(e) => set("paid", e.target.checked)} />
            Mark as paid now
          </label>
        </div>

        <div className="mt-3 flex justify-end">
          <Button onClick={submit} disabled={busy || staff.length === 0}>
            {busy ? "Recording…" : "Record salary"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
