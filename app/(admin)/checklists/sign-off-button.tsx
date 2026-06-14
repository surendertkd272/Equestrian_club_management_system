"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";

// Stable-manager countersign on a submission (the PDF's manager-signature line).
export function SignOffButton({
  submissionId,
  reviewedAt,
  canReview,
}: {
  submissionId: string;
  reviewedAt: string | null;
  canReview: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (reviewedAt) {
    return <span className="text-xs text-emerald-700">✓ {formatDate(reviewedAt)}</span>;
  }
  if (!canReview) return <span className="text-xs text-muted-foreground">—</span>;

  async function signOff() {
    setBusy(true);
    try {
      const res = await fetch(`/api/checklists/submissions/${submissionId}/review`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Signed off");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOff}
      disabled={busy}
      className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
    >
      {busy ? "…" : "Sign off"}
    </button>
  );
}
