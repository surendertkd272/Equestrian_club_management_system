"use client";

// Reassign a single session's coach, inline on the day list.
//
// Lesson.coachId and PATCH /api/lessons/[id] have always supported this — the
// API accepted a reassignment and the database stored it. Nothing in the UI
// ever showed a coach or let you change one, so the most ordinary event in a
// riding school ("Arjun is off sick, Imran covers the 6am") had no answer in
// the product at all. A manager's only trace of it was a lesson renamed
// "Coach Arjun sick - cancelled".

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";

type Coach = { id: string; name: string };

export function LessonCoachPicker({
  lessonId,
  coachId,
  coaches,
  canEdit,
  formerCoachName,
}: {
  lessonId: string;
  coachId: string | null;
  coaches: Coach[];
  canEdit: boolean;
  /**
   * Name of the assigned coach when they are no longer in the active list —
   * they left, changed role, or moved centre. Lesson.coachId has no FK, so
   * without this the control showed "Unassigned" for a lesson that WAS
   * covered, and saving anything else silently erased who actually taught it.
   */
  formerCoachName?: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(coachId ?? "");
  const [busy, setBusy] = useState(false);

  const currentName = coaches.find((c) => c.id === value)?.name ?? (value ? formerCoachName ?? undefined : undefined);

  if (!canEdit) {
    return (
      <span className="text-xs text-muted-foreground">
        {currentName ?? "Unassigned"}
      </span>
    );
  }

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setBusy(true);
    const res = await patchJson(`/api/lessons/${lessonId}`, { coachId: next || null });
    setBusy(false);
    if (!res.ok) {
      setValue(previous); // put the control back so it never lies about state
      toast.error(res.message);
      return;
    }
    toast.success(next ? `Now taken by ${coaches.find((c) => c.id === next)?.name}.` : "Coach cleared.");
    router.refresh();
  }

  return (
    <select
      aria-label="Coach for this session"
      value={value}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      className="h-7 max-w-[10rem] rounded border bg-card px-1 text-xs disabled:opacity-60"
    >
      <option value="">— Unassigned —</option>
      {coaches.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      {value && !coaches.some((c) => c.id === value) && (
        <option value={value}>{formerCoachName ?? "Former coach"} (no longer active)</option>
      )}
    </select>
  );
}
