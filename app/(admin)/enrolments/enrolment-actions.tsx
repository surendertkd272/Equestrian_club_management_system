"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

export function EnrolmentActions({ riderId }: { riderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function act(action: "approve" | "reject") {
    if (action === "reject") {
      const ok = await openConfirm({
        title: "Reject this enrolment?",
        body: "The rider won't be registered. This can't be undone from here.",
        confirmLabel: "Reject",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const res = await fetch(`/api/enrolments/${riderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success(action === "approve" ? `Approved · ₹${data.amount} invoice raised` : "Rejected");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" onClick={() => act("reject")} disabled={busy !== null}>
        {busy === "reject" ? "…" : "Reject"}
      </Button>
      <Button size="sm" onClick={() => act("approve")} disabled={busy !== null}>
        {busy === "approve" ? "…" : "Approve"}
      </Button>
    </div>
  );
}
