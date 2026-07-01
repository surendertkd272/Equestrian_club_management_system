"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postJson } from "@/lib/client/post-json";
import { Check, CheckCheck } from "lucide-react";

export function MarkRead({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    await postJson(`/api/notifications/${id}/read`);
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
    const res = await postJson<{ count: number }>("/api/notifications/read-all");
    setBusy(false);
    if (res.ok) {
      toast.success(`Marked ${res.data.count} read`);
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
      <CheckCheck className="h-3.5 w-3.5" /> Mark All Read
    </button>
  );
}
