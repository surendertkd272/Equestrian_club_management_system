"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

/**
 * Approve / reject one pending enrolment.
 *
 * `verified` gates Approve because the API does: approval 409s until a rider's
 * documents have been attested, and attesting is restricted to HQ and the
 * centre manager. This component is rendered on the SCHOOL portal, whose users
 * are deliberately not verifiers — so an un-gated Approve button was an action
 * a school administrator could never once complete, failing with a message
 * telling them to do something they have no screen for. Saying so up front is
 * the difference between a queue and a dead end.
 */
export function EnrolmentActions({
  riderId,
  verified = true,
}: {
  riderId: string;
  verified?: boolean;
}) {
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
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(action === "approve" ? `Approved · ₹${data.amount} invoice raised` : "Rejected");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => act("reject")} disabled={busy !== null}>
          {busy === "reject" ? "…" : "Reject"}
        </Button>
        <Button
          size="sm"
          onClick={() => act("approve")}
          disabled={busy !== null || !verified}
          title={
            verified
              ? undefined
              : "The club has to check this rider's documents before anyone can approve them."
          }
        >
          {busy === "approve" ? "…" : "Approve"}
        </Button>
      </div>
      {!verified && (
        <span className="text-[11px] text-muted-foreground">
          Waiting on the club to check documents
        </span>
      )}
    </div>
  );
}
