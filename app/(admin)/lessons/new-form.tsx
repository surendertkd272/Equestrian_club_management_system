"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { postJson } from "@/lib/client/post-json";

type Batch = { id: string; name: string; startTime: string; endTime: string };

export function NewLessonForm({
  centreId,
  batches,
  defaultDate,
}: {
  centreId: string;
  batches: Batch[];
  defaultDate: string;
}) {
  const router = useRouter();
  const [batchId, setBatchId] = useState<string>("");
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("06:00");
  const [end, setEnd] = useState("07:00");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  function onBatchPick(id: string) {
    setBatchId(id);
    const b = batches.find((x) => x.id === id);
    if (b) {
      setStart(b.startTime);
      setEnd(b.endTime);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await postJson("/api/lessons", {
      batchId: batchId || null,
      centreId,
      date: new Date(`${date}T${start}`).toISOString(),
      endAt: new Date(`${date}T${end}`).toISOString(),
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Lesson scheduled.");
    setNotes("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-5">
      <div className="md:col-span-2">
        <Label className="text-xs">Batch (optional)</Label>
        <select
          value={batchId}
          onChange={(e) => onBatchPick(e.target.value)}
          className="h-9 w-full rounded border bg-card px-2 text-sm"
        >
          <option value="">— Ad-hoc / make-up —</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.startTime}–{b.endTime})
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label className="text-xs">Date</Label>
        <Input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div>
        <Label className="text-xs">Start</Label>
        <Input aria-label="Start" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
      </div>
      <div>
        <Label className="text-xs">End</Label>
        <Input aria-label="End" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
      </div>
      <div className="md:col-span-4">
        <Label className="text-xs">Notes (optional)</Label>
        <Input aria-label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Make-up class · special focus on dressage transitions" />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Saving…" : "Schedule"}
        </Button>
      </div>
    </form>
  );
}
