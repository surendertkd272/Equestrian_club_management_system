"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

// Delete-lesson button. Mounted on each row of the lessons list. The
// API enforces role + cross-centre + read-only — this is just the
// confirm + dispatch shell. HorseAllocation rows tied to the lesson
// keep existing with lessonId=null (per the schema's onDelete: SetNull),
// so historical allocation context isn't lost.

export function LessonDeleteButton({
  id,
  timeLabel,
  riderCount,
}: {
  id: string;
  // Used in the confirm body so the user knows which lesson they're nuking.
  timeLabel: string;
  // Surfaces the blast radius — if riders were already allocated, the
  // confirm warns them.
  riderCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const ok = await openConfirm({
      title: `Delete the ${timeLabel} lesson?`,
      body:
        riderCount > 0
          ? `${riderCount} rider${riderCount === 1 ? "" : "s"} ${riderCount === 1 ? "is" : "are"} currently allocated. Deletion removes the lesson; rider/horse allocation history is preserved.`
          : "This removes the lesson permanently.",
      destructive: true,
      confirmLabel: "Delete lesson",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lessons/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Delete failed");
        return;
      }
      toast.success("Lesson deleted");
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
      aria-label="Delete lesson"
      title="Delete lesson"
      className="rounded border px-2 py-1 text-destructive hover:bg-destructive/10 disabled:opacity-50"
    >
      <Trash2 className="h-3 w-3" />
    </button>
  );
}
