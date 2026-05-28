"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { DEDUCTIBLE_STATUSES, STATUS_LABEL } from "@/lib/schemas/payroll";

// Global per-status deduction rates. Super Admin / Admin fill in ₹/day for
// each absence type; blank or 0 = no deduction for that status.
export function PayrollSettings({
  initialRules,
  canEdit,
}: {
  initialRules: Record<string, number>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of DEDUCTIBLE_STATUSES) out[s] = initialRules[s] != null ? String(initialRules[s]) : "";
    return out;
  });

  async function save() {
    const payload: Record<string, number> = {};
    for (const s of DEDUCTIBLE_STATUSES) {
      const n = Number(rules[s]);
      if (Number.isFinite(n) && n > 0) payload[s] = n;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/payroll/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deductionRules: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Deduction rates saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payroll deduction settings (global)</CardTitle>
        <CardDescription>
          Set how much is deducted per day for each attendance status, across all clubs.
          Leave blank for no deduction. {canEdit ? "" : "Read-only — set by an admin."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-4">
          {DEDUCTIBLE_STATUSES.map((s) => (
            <div key={s}>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {STATUS_LABEL[s] ?? s} — ₹/day
              </label>
              <Input
                type="number"
                inputMode="numeric"
                value={rules[s]}
                onChange={(e) => setRules((r) => ({ ...r, [s]: e.target.value }))}
                placeholder="0"
                disabled={!canEdit}
              />
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="mt-3 flex justify-end">
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save rates"}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
