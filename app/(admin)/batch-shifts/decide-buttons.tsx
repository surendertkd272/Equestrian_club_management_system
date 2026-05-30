"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openConfirm } from "@/components/ui/confirm-dialog";

// Inline Approve / Reject buttons for a pending batch shift request.
// Reject prompts for a confirm + optional note (typed into the dialog);
// approve goes through immediately because the side-effect (attendance
// row or rider.batchId flip) is reversible by the admin via re-approval
// of an opposite shift.

export function DecideButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function decide(decision: "approve" | "reject", note?: string) {
    setBusy(decision);
    try {
      const res = await fetch(`/api/batch-shift-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(decision === "approve" ? "Approved" : "Rejected");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => decide("approve")} disabled={!!busy}>
        {busy === "approve" ? "…" : "Approve"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          const ok = await openConfirm({
            title: "Reject this batch shift request?",
            body: "The rider will be notified that the request was declined.",
            destructive: true,
            confirmLabel: "Reject",
          });
          if (ok) decide("reject");
        }}
        disabled={!!busy}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        {busy === "reject" ? "…" : "Reject"}
      </Button>
    </div>
  );
}
