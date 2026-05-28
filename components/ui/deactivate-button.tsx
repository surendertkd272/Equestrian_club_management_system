"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

// Generic soft-delete control for catalog rows. Calls DELETE on the given
// API path (which deactivates, active=false) and refreshes. Used across
// vendors / medicines / consumables / teams so admins can remove entries.
export function DeactivateButton({
  apiPath,
  label = "Remove",
  itemName,
  size = "sm",
}: {
  apiPath: string;
  label?: string;
  itemName?: string;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go() {
    const ok = await openConfirm({
      title: "Remove this entry?",
      body: itemName
        ? `"${itemName}" will be hidden from lists. History is preserved.`
        : "It will be hidden from lists. History is preserved.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(apiPath, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Removed");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size={size} variant="ghost" onClick={go} disabled={busy} className="text-destructive hover:text-destructive">
      {busy ? "…" : label}
    </Button>
  );
}
