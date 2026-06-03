"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";

type StaffRow = {
  id: string;
  name: string;
  role: string;
  monthlySalary: number | null;
  effectiveFrom: string | null;
  revisions: number;
};

// Salary master — current salary per staff + a "set / raise" action. A raise
// is a new effective-dated row, so history is preserved.
export function SalaryStructureTable({ staff, canEdit }: { staff: StaffRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ monthlySalary: "", effectiveFrom: today, note: "" });

  function startEdit(row: StaffRow) {
    setEditing(row.id);
    setForm({
      monthlySalary: row.monthlySalary != null ? String(row.monthlySalary) : "",
      effectiveFrom: today,
      note: "",
    });
  }

  async function save(userId: string) {
    const amount = Number(form.monthlySalary);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid monthly salary.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/salary/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          monthlySalary: amount,
          effectiveFrom: form.effectiveFrom,
          note: form.note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Salary saved");
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Staff salary structure</CardTitle>
        <CardDescription>
          Each staff member's current monthly salary. "Set / raise" adds a new effective-dated
          entry — past records are kept for history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2">Staff</th>
                <th className="pb-2 text-right">Current salary</th>
                <th className="pb-2">Effective from</th>
                <th className="pb-2 text-center">Revisions</th>
                <th className="pb-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((row) => (
                <Fragment key={row.id}>
                  <tr className="border-t">
                    <td className="py-2">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-[11px] text-muted-foreground">{row.role.replace(/_/g, " ").toLowerCase()}</div>
                    </td>
                    <td className="py-2 text-right font-mono">
                      {row.monthlySalary != null ? `₹${Math.round(row.monthlySalary).toLocaleString("en-IN")}` : <span className="text-amber-700">not set</span>}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {row.effectiveFrom ? formatDate(new Date(row.effectiveFrom)) : "—"}
                    </td>
                    <td className="py-2 text-center text-xs text-muted-foreground">{row.revisions || "—"}</td>
                    <td className="py-2 text-right">
                      {canEdit ? (
                        <Button size="sm" variant="outline" onClick={() => startEdit(row)} disabled={busy}>
                          {row.monthlySalary != null ? "Raise / edit" : "Set salary"}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                  {editing === row.id && (
                    <tr className="bg-muted/30">
                      <td colSpan={5} className="px-2 py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Monthly salary (₹)</label>
                            <Input type="number" value={form.monthlySalary} onChange={(e) => setForm((f) => ({ ...f, monthlySalary: e.target.value }))} className="w-36" />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Effective from</label>
                            <Input type="date" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} className="w-40" />
                          </div>
                          <div className="flex-1 min-w-[160px]">
                            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Note (optional)</label>
                            <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Annual increment" />
                          </div>
                          <Button size="sm" onClick={() => save(row.id)} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">No active staff.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
