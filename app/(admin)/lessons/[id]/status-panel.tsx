"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";

const NEXT: Record<string, { label: string; status: string; variant?: "default" | "outline" | "destructive" }[]> = {
  scheduled: [
    { label: "Mark Complete", status: "completed" },
    { label: "Cancel", status: "cancelled", variant: "destructive" },
  ],
  completed: [{ label: "Re-Open", status: "scheduled", variant: "outline" }],
  cancelled: [{ label: "Re-Schedule", status: "scheduled", variant: "outline" }],
  rescheduled: [],
};

export function LessonStatusPanel({ lessonId, status }: { lessonId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function transition(next: string) {
    setBusy(true);
    const res = await patchJson(`/api/lessons/${lessonId}`, { status: next });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
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
