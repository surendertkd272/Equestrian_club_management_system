"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CheckCheck } from "lucide-react";

export function MarkRead({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    setBusy(false);
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="mark read"
      title="Mark read"
    >
      <Check className="h-4 w-4" />
    </button>
  );
}

export function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    const res = await fetch("/api/notifications/read-all", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      toast.success(`Marked ${data.count} read`);
      router.refresh();
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
    >
      <CheckCheck className="h-3.5 w-3.5" /> Mark all read
    </button>
  );
}
