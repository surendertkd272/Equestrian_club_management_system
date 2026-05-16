"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

export function DeleteAllocation({ horseId, allocId }: { horseId: string; allocId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const ok = await openConfirm({ title: "Remove this allocation?", destructive: true, confirmLabel: "Remove" });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/horses/${horseId}/allocations/${allocId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed");
      return;
    }
    toast.success("Removed");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="text-muted-foreground hover:text-destructive"
      aria-label="remove"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
