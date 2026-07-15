"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";

// Change the date / start / end of an existing lesson. The initial values are
// the lesson's current time already expressed in the CENTRE's zone (computed
// server-side), and we send back the picked wall-clock time as a zoneless
// string — the API re-interprets it in the centre's zone (see PATCH
// /api/lessons/[id]). Keeping the browser out of the timezone maths means an
// HQ admin in another zone still sets the centre's local time correctly.
export function LessonTimeEditor({
  lessonId,
  initialDate,
  initialStart,
  initialEnd,
}: {
  lessonId: string;
  initialDate: string;
  initialStart: string;
  initialEnd: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);

  async function save() {
    if (!date || !start || !end) return toast.error("Date, start and end are all required.");
    // Lessons are single-day, so comparing the raw HH:MM on a fixed day is
    // enough and stays independent of any timezone.
    if (!(new Date(`2000-01-01T${end}`) > new Date(`2000-01-01T${start}`))) {
      return toast.error("End time must be after the start time.");
    }
    setBusy(true);
    const res = await patchJson(`/api/lessons/${lessonId}`, {
      date: `${date}T${start}`,
      endAt: `${date}T${end}`,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Lesson time updated.");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-primary hover:underline">
        Edit time
      </button>
    );
  }

  return (
    <div className="mt-2 grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-3">
      <div>
        <Label className="text-xs">Date</Label>
        <Input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">Start</Label>
        <Input aria-label="Start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">End</Label>
        <Input aria-label="End" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="flex gap-2 sm:col-span-3">
        <Button size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save time"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
