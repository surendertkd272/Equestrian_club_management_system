"use client";

// Edit a live batch.
//
// There was no way to do this at all: the API had only DELETE, and DELETE
// refuses once riders are assigned. So the first Saturday a club moved its
// 6am class to 6:30, or a coach handed a batch over, the only options were to
// live with a wrong timetable or empty the batch out and rebuild it — losing
// the attendance history hanging off it. Managers worked around it by putting
// the truth in the name ("Beginners 6am (now 6:30)"), which is what tipped
// this off during the simulation.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Pencil } from "lucide-react";
import { useFocusTrap } from "@/lib/use-focus-trap";

const DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type BatchEditable = {
  id: string;
  name: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  level: string | null;
  coachId: string | null;
};

export function BatchEditButton({
  batch,
  coaches,
  riderCount,
}: {
  batch: BatchEditable;
  // Coaches at THIS batch's centre — an HQ admin looking at every centre at
  // once must not be offered a Ghaziabad coach for a Gurgaon batch (the API
  // rejects it as INVALID_COACH, but the list shouldn't tempt them either).
  coaches: { id: string; name: string }[];
  riderCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const blank = () => ({
    name: batch.name,
    dayOfWeek: batch.dayOfWeek,
    startTime: batch.startTime,
    endTime: batch.endTime,
    level: batch.level ?? "",
    coachId: batch.coachId ?? "",
  });
  const [form, setForm] = useState(blank);
  const dialogRef = useRef<HTMLFormElement>(null);
  useFocusTrap(dialogRef, open);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Re-seed from props every time the dialog opens. The state initialiser runs
  // once, so without this an abandoned edit — or a change someone else made
  // that arrived via router.refresh() — stayed in the form and, because submit
  // sends only the fields that differ from the CURRENT props, got written on
  // the next save as a field the operator never touched.
  function open_() {
    setForm(blank());
    setOpen(true);
  }
  function close_() {
    setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.endTime <= form.startTime) {
      toast.error("End time must be after the start time.");
      return;
    }
    setBusy(true);
    // Send only what actually changed, so an edit to the name can never
    // silently rewrite the coach or the days as a side effect.
    const patch: Record<string, string | null> = {};
    if (form.name !== batch.name) patch.name = form.name;
    if (form.dayOfWeek !== batch.dayOfWeek) patch.dayOfWeek = form.dayOfWeek;
    if (form.startTime !== batch.startTime) patch.startTime = form.startTime;
    if (form.endTime !== batch.endTime) patch.endTime = form.endTime;
    if (form.level !== (batch.level ?? "")) patch.level = form.level || null;
    if (form.coachId !== (batch.coachId ?? "")) patch.coachId = form.coachId || null;

    if (Object.keys(patch).length === 0) {
      setBusy(false);
      setOpen(false);
      return;
    }
    const res = await patchJson(`/api/batches/${batch.id}`, patch);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Batch updated");
    setOpen(false);
    router.refresh();
  }

  const timesChanged = form.startTime !== batch.startTime || form.endTime !== batch.endTime;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={open_}
        aria-label="Edit batch"
        title="Edit batch"
      >
        <Pencil className="h-3 w-3" />
      </Button>
      {open && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={close_} aria-hidden />
          <form
            ref={dialogRef}
            onSubmit={submit}
            onKeyDown={(e) => {
              if (e.key === "Escape") close_();
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${batch.name}`}
            tabIndex={-1}
            className="absolute left-1/2 top-[10%] z-50 max-h-[80vh] w-full max-w-sm -translate-x-1/2 space-y-3 overflow-y-auto rounded-lg border bg-card p-4 text-left shadow-xl outline-none"
          >
            <h2 className="text-base font-semibold">Edit Batch</h2>

            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                aria-label="Name"
                required
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label>Days</Label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                {DAY_OPTIONS.map((day) => {
                  const selected = form.dayOfWeek.split(",").map((s) => s.trim()).includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        const days = form.dayOfWeek.split(",").map((s) => s.trim()).filter(Boolean);
                        const next = selected ? days.filter((d) => d !== day) : [...days, day];
                        set("dayOfWeek", DAY_OPTIONS.filter((d) => next.includes(d)).join(","));
                      }}
                      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              {form.dayOfWeek === "" && <p className="text-xs text-rose-600">Pick at least one day.</p>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Start</Label>
                <Input
                  aria-label="Start"
                  required
                  type="time"
                  value={form.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <Input
                  aria-label="End"
                  required
                  type="time"
                  value={form.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Level</Label>
              <Select aria-label="Level" value={form.level} onChange={(e) => set("level", e.target.value)}>
                <option value="">(none)</option>
                <option>Beginner</option>
                <option>Intermediate</option>
                <option>Advanced</option>
                <option>Pro</option>
                {/* Keep a level that was set before these options existed. */}
                {form.level &&
                  !["Beginner", "Intermediate", "Advanced", "Pro"].includes(form.level) && (
                    <option>{form.level}</option>
                  )}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Coach</Label>
              <Select aria-label="Coach" value={form.coachId} onChange={(e) => set("coachId", e.target.value)}>
                <option value="">(none)</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {/* The batch's current coach may have left or changed role and
                    so be absent from the active list — don't silently drop them
                    from the control and clear the assignment on save. */}
                {batch.coachId && !coaches.some((c) => c.id === batch.coachId) && (
                  <option value={batch.coachId}>(current coach — no longer active)</option>
                )}
              </Select>
            </div>

            {timesChanged && (
              <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Sessions already on the calendar keep their old time — horses and
                attendance are booked against them. This sets the time for
                sessions generated from now on.
                {riderCount > 0 && ` ${riderCount} rider${riderCount === 1 ? "" : "s"} are in this batch; tell them.`}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={close_} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || form.dayOfWeek === "" || form.name.trim().length < 2}>
                {busy ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
