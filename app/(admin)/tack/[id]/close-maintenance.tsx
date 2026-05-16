"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

export function CloseMaintenance({ assetId, maintenanceId }: { assetId: string; maintenanceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const ok = await openConfirm({
      title: "Mark as repaired?",
      body: "The asset will be put back in service.",
      confirmLabel: "Mark repaired",
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/assets/${assetId}/maintenance`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maintenanceId }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed");
      return;
    }
    toast.success("Repair closed");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-md border bg-card px-2 py-1 text-xs font-medium hover:bg-muted"
    >
      Mark repaired
    </button>
  );
}
