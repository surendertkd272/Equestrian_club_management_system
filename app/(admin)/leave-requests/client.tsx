"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function NewLeaveRequestForm() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason.trim()) {
      toast.error("Reason is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Submitted");
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <Label htmlFor="lr-start">Start</Label>
        <Input id="lr-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="lr-end">End</Label>
        <Input id="lr-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="lr-reason">Reason</Label>
        <Textarea
          id="lr-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Why you need this leave"
        />
      </div>
      <div className="sm:col-span-3">
        <Button onClick={submit} disabled={busy}>
          {busy ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </div>
  );
}

export function LeaveRequestActions({
  id,
  status,
  isApprover,
  isRequester,
}: {
  id: string;
  status: string;
  isApprover: boolean;
  isRequester: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function send(decision: "approved" | "rejected" | "cancelled", reviewNotes?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leave-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reviewNotes }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(`Marked ${decision}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status !== "pending") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex justify-end gap-2">
      {isApprover && (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => send("rejected")}>
            Reject
          </Button>
          <Button size="sm" disabled={busy} onClick={() => send("approved")}>
            Approve
          </Button>
        </>
      )}
      {isRequester && !isApprover && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => send("cancelled")}>
          Cancel
        </Button>
      )}
    </div>
  );
}
