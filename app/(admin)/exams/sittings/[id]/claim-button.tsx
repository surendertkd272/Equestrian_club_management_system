"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Pick a rider from the sitting pool. On success the exam is locked to the
// caller and we open its marking sheet.
export function ClaimButton({ examId }: { examId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function claim() {
    setBusy(true);
    try {
      const res = await fetch(`/api/exams/${examId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.error === "ALREADY_CLAIMED"
            ? "Another examiner just picked this rider."
            : data.error ?? "Failed",
        );
        router.refresh();
        return;
      }
      toast.success("Assigned to you — opening the sheet…");
      router.push(`/exams/${examId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={claim} disabled={busy}>
      {busy ? "Picking…" : "Pick & mark"}
    </Button>
  );
}
