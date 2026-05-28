"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Staff = { id: string; name: string; role: string };

export function StaffAttendanceMarker({ staff, defaultDate }: { staff: Staff[]; defaultDate: string }) {
  const router = useRouter();
  const [userId, setUserId] = useState(staff[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [status, setStatus] = useState("present");
  const [checkInAt, setCheckInAt] = useState("");
  const [checkOutAt, setCheckOutAt] = useState("");
  const [overtimeHours, setOvertimeHours] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!userId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/staff-attendance/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          date,
          status,
          checkInAt: checkInAt || undefined,
          checkOutAt: checkOutAt || undefined,
          overtimeHours: overtimeHours ? Number(overtimeHours) : undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Marked");
      setCheckInAt("");
      setCheckOutAt("");
      setOvertimeHours("");
      setNotes("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (staff.length === 0) {
    return <p className="text-sm text-muted-foreground">No staff users in this centre yet.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
      <div className="lg:col-span-2">
        <Label htmlFor="sa-user">Staff</Label>
        <select
          id="sa-user"
          className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.role.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="sa-date">Date</Label>
        <Input id="sa-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="sa-status">Status</Label>
        <select
          id="sa-status"
          className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="present">present</option>
          <option value="late">late</option>
          <option value="half_day">half day</option>
          <option value="absent">absent</option>
          <option value="leave">leave</option>
        </select>
      </div>
      <div>
        <Label htmlFor="sa-in">Check-in</Label>
        <Input id="sa-in" type="time" value={checkInAt} onChange={(e) => setCheckInAt(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="sa-out">Check-out</Label>
        <Input id="sa-out" type="time" value={checkOutAt} onChange={(e) => setCheckOutAt(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="sa-ot">OT hours</Label>
        <Input
          id="sa-ot"
          type="number"
          min="0"
          step="0.5"
          value={overtimeHours}
          onChange={(e) => setOvertimeHours(e.target.value)}
        />
      </div>
      <div className="lg:col-span-7">
        <Label htmlFor="sa-notes">Notes</Label>
        <Input id="sa-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>
      <div className="lg:col-span-7">
        <Button onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Mark"}
        </Button>
      </div>
    </div>
  );
}
