"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { openPrompt } from "@/components/ui/prompt-dialog";
import { postJson } from "@/lib/client/post-json";

export function ReviewButtons({
  id,
  canReview,
  isMine,
}: {
  id: string;
  canReview: boolean;
  isMine: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function review(decision: "approved" | "rejected" | "cancelled") {
    let reviewNotes = "";
    if (decision === "rejected") {
      const note = await openPrompt({
        title: "Reject Request",
        label: "Reason for Rejecting",
        body: "Shown to the requester.",
        multiline: true,
        confirmLabel: "Reject",
      });
      if (note === null) return;
      reviewNotes = note;
    } else if (decision === "cancelled") {
      const ok = await openConfirm({
        title: "Cancel this request?",
        confirmLabel: "Cancel Request",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await postJson(`/api/approvals/${id}/review`, { decision, reviewNotes: reviewNotes || undefined });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Marked ${decision}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {canReview && (
        <div className="flex gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => review("approved")}
            className="rounded border border-emerald-500 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => review("rejected")}
            className="rounded border border-rose-500 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
      {isMine && (
        <button
          type="button"
          disabled={busy}
          onClick={() => review("cancelled")}
          className="rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
