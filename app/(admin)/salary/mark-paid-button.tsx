"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Tiny inline button for the salary list. Only renders when the row's
// paidAt is null; the API is idempotent so even a double-click is safe.
export function MarkPaidButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function markPaid() {
    setBusy(true);
    try {
      const res = await fetch(`/api/salary/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_paid" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(data.alreadyPaid ? "Already marked paid" : "Marked paid");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={markPaid} disabled={busy} className="text-xs">
      {busy ? "…" : "Mark paid"}
    </Button>
  );
}
