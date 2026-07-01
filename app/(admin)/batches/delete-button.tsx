"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

// Delete-batch button. Mounted in the batches list table on every row.
// The API enforces FK safety (refuses if riders are still assigned and
// returns BATCH_HAS_RIDERS); we surface that to the user as a 'reassign
// riders first' nudge rather than a generic error.

export function BatchDeleteButton({
  id,
  name,
  riderCount,
}: {
  id: string;
  name: string;
  riderCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (riderCount > 0) {
      toast.error(
        `${name} has ${riderCount} rider${riderCount === 1 ? "" : "s"} assigned. Reassign them to another batch first, then delete.`,
      );
      return;
    }
    const ok = await openConfirm({
      title: `Delete "${name}"?`,
      body: "This removes the batch and its attendance history permanently.",
      destructive: true,
      confirmLabel: "Delete Batch",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/batches/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Delete failed");
        return;
      }
      toast.success("Batch deleted");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={busy}
      aria-label="Delete batch"
      title="Delete batch"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  );
}
