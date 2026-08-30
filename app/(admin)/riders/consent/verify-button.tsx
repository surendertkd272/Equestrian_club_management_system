"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Confirms a signature that arrived via an emailed link. */
export function VerifySignatureButton({ riderId }: { riderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    try {
      const res = await fetch(`/api/enrolments/${riderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Couldn't verify");
        return;
      }
      toast.success("Signature confirmed");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={verify} disabled={busy}>
      {busy ? "…" : "Confirm"}
    </Button>
  );
}
