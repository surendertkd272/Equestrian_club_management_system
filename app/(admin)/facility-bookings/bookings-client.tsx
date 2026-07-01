"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { formatEnum } from "@/lib/labels";
type Facility = { id: string; name: string; type: string; capacity: number | null };

export function BookingsClient({
  canBook,
  facilities,
}: {
  canBook: boolean;
  facilities: Facility[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    facilityId: facilities[0]?.id ?? "",
    purpose: "lesson",
    title: "",
    startAt: "",
    endAt: "",
    notes: "",
  });
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function book() {
    if (!form.facilityId || !form.title || !form.startAt || !form.endAt) {
      toast.error("Facility, title, start and end are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/facility-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId: form.facilityId,
          purpose: form.purpose,
          title: form.title,
          startAt: form.startAt,
          endAt: form.endAt,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "FACILITY_CONFLICT"
            ? `Conflicts with "${data.details?.conflictWith}" (${new Date(data.details?.start).toLocaleString()} → ${new Date(data.details?.end).toLocaleString()}).`
          : data.error === "INVALID_TIME_RANGE"
            ? "End time must be after start time."
            : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success("Booked");
      setForm((f) => ({ ...f, title: "", startAt: "", endAt: "", notes: "" }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!canBook) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reserve a Facility</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Centre managers and head coaches can book facilities. You can still see the schedule
            below.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (facilities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reserve a Facility</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No facilities configured. Add some via the centres panel before booking.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reserve a Facility</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Facility</Label>
            <Select aria-label="Facility" value={form.facilityId} onChange={(e) => set("facilityId", e.target.value)}>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({formatEnum(f.type)})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Purpose</Label>
            <Select aria-label="Purpose" value={form.purpose} onChange={(e) => set("purpose", e.target.value)}>
              <option value="lesson">Lesson</option>
              <option value="exam">Exam</option>
              <option value="competition">Competition</option>
              <option value="maintenance">Maintenance</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div>
            <Label>Title</Label>
            <Input aria-label="Title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="L1 promotion exam" />
          </div>
          <div>
            <Label>Start</Label>
            <Input aria-label="Start"
              type="datetime-local"
              value={form.startAt}
              onChange={(e) => set("startAt", e.target.value)}
            />
          </div>
          <div>
            <Label>End</Label>
            <Input aria-label="End"
              type="datetime-local"
              value={form.endAt}
              onChange={(e) => set("endAt", e.target.value)}
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Input aria-label="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={book} disabled={busy}>{busy ? "Booking…" : "Book facility"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
