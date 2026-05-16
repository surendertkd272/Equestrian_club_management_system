"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function RevokeButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const reason = window.prompt("Reason for revoking (shown on the public verify page):");
    if (!reason || reason.trim().length < 2) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/certificates/${id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        toast.error("Revoke failed");
        return;
      }
      toast.success("Revoked");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="text-xs text-rose-700 underline disabled:opacity-50"
    >
      Revoke
    </button>
  );
}
