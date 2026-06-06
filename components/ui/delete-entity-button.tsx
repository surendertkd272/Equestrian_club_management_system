"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

// Generic guarded DELETE button for a single entity. The server enforces the
// real rules (e.g. can't delete a live/completed competition → 409); we just
// confirm, fire, and surface the server's message.
export function DeleteEntityButton({
  endpoint,
  entityLabel,
  redirectTo,
  confirmBody,
}: {
  endpoint: string;
  entityLabel: string;
  redirectTo: string;
  confirmBody?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    const ok = await openConfirm({
      title: `Delete this ${entityLabel}?`,
      body: confirmBody ?? `This permanently removes the ${entityLabel}. This cannot be undone.`,
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.message ?? d.error ?? "Couldn't delete");
        return;
      }
      toast.success(`${entityLabel[0].toUpperCase()}${entityLabel.slice(1)} deleted`);
      router.push(redirectTo);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" disabled={busy} onClick={onDelete}>
      <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
    </Button>
  );
}
