"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { openPrompt } from "@/components/ui/prompt-dialog";
import { postJson } from "@/lib/client/post-json";

export function RevokeButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const reason = await openPrompt({
      title: "Revoke certificate",
      body: "This is shown on the public verify page.",
      label: "Reason for Revoking",
      multiline: true,
      required: true,
      confirmLabel: "Revoke",
    });
    if (!reason || reason.trim().length < 2) return;
    setBusy(true);
    try {
      const res = await postJson(`/api/certificates/${id}/revoke`, { reason: reason.trim() });
      if (!res.ok) {
        toast.error(res.message);
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
