"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const NEXT: Record<string, { label: string; status: string; variant?: "default" | "outline" | "destructive" }[]> = {
  scheduled: [
    { label: "Mark complete", status: "completed" },
    { label: "Cancel", status: "cancelled", variant: "destructive" },
  ],
  completed: [{ label: "Re-open", status: "scheduled", variant: "outline" }],
  cancelled: [{ label: "Re-schedule", status: "scheduled", variant: "outline" }],
  rescheduled: [],
};

export function LessonStatusPanel({ lessonId, status }: { lessonId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function transition(next: string) {
    setBusy(true);
    const res = await fetch(`/api/lessons/${lessonId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.message ?? data.error ?? "Failed");
      return;
    }
    toast.success(`Lesson marked ${next}.`);
    router.refresh();
  }

  const options = NEXT[status] ?? [];
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button key={o.status} variant={o.variant ?? "default"} size="sm" onClick={() => transition(o.status)} disabled={busy}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}
