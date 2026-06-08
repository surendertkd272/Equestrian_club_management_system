"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Initial = {
  status: string;
  scheduledAt: string | null;
  notes: string | null;
};

export function OffboardPanel({
  tenantId,
  tenantName,
  initial,
  canManage,
}: {
  tenantId: string;
  tenantName: string;
  initial: Initial;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [graceDays, setGraceDays] = useState("30");
  const [notes, setNotes] = useState("");

  const scheduled = !!initial.scheduledAt;
  const scrubAt = initial.scheduledAt ? new Date(new Date(initial.scheduledAt).getTime() + 30 * 86400000) : null;
  const daysLeft = scrubAt ? Math.max(0, Math.round((scrubAt.getTime() - Date.now()) / 86400000)) : null;

  async function schedule() {
    const ok = await openConfirm({
      title: `Schedule ${tenantName} for closure?`,
      body: `After ${graceDays} days, every record for this tenant is permanently deleted. The customer is emailed immediately with instructions to download their data and cancel if they change their mind.`,
      destructive: true,
      confirmLabel: "Schedule closure",
      typeToConfirm: tenantName,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/owner/tenants/${tenantId}/offboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graceDays: Number(graceDays), notes: notes.trim() || null }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.message ?? data.error ?? "Failed");
      return;
    }
    toast.success("Closure scheduled. Customer notified.");
    router.refresh();
  }

  async function cancel() {
    const ok = await openConfirm({
      title: "Cancel the scheduled closure?",
      body: "Tenant returns to active state. No data was deleted yet.",
      destructive: false,
      confirmLabel: "Restore tenant",
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/owner/tenants/${tenantId}/offboard`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.message ?? data.error ?? "Failed");
      return;
    }
    toast.success("Restored.");
    router.refresh();
  }

  if (scheduled) {
    return (
      <div className="rounded-md border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-900 dark:text-rose-100">
        <div className="font-semibold">Closure scheduled</div>
        <div className="mt-1 text-xs">
          Data is wiped on{" "}
          <strong>{scrubAt!.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</strong>
          {" "}({daysLeft} day{daysLeft === 1 ? "" : "s"} from now).
        </div>
        {initial.notes && <div className="mt-2 text-xs italic">Note: {initial.notes}</div>}
        {canManage && (
          <Button variant="outline" onClick={cancel} disabled={busy} className="mt-3 border-border text-foreground hover:bg-muted">
            {busy ? "Restoring…" : "Cancel closure / restore tenant"}
          </Button>
        )}
      </div>
    );
  }

  if (!canManage) {
    return <p className="text-xs text-muted-foreground">You don't have permission to offboard tenants.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Schedules permanent deletion. Customer gets an immediate email with their
        data-download link and a cancellation window.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs text-muted-foreground">Grace days</Label>
          <Input aria-label="Grace days"
            type="number"
            min={0}
            max={180}
            value={graceDays}
            onChange={(e) => setGraceDays(e.target.value)}
            className="border-border bg-background text-foreground"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Reason (internal notes)</Label>
        <Input aria-label="Reason (internal notes)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Customer cancelled · GDPR request · Payment defaulted 90d"
          className="border-border bg-background text-foreground"
        />
      </div>
      <Button variant="destructive" onClick={schedule} disabled={busy}>
        {busy ? "Scheduling…" : "Schedule closure"}
      </Button>
    </div>
  );
}
