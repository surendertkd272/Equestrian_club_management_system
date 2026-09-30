"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/client/post-json";

// Mark the rider absent (didn't turn up), with an optional reason, or undo it.
export function AbsentToggle({ examId, absent }: { examId: string; absent: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(nextAbsent: boolean) {
    setBusy(true);
    const res = await postJson(`/api/exams/${examId}/absent`, { absent: nextAbsent, reason: reason || undefined });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(nextAbsent ? "Marked absent" : "Back in the queue");
    setAsking(false);
    router.refresh();
  }

  if (absent) {
    return (
      <Button size="sm" variant="outline" onClick={() => send(false)} disabled={busy}>
        Undo absent
      </Button>
    );
  }
  if (!asking) {
    return (
      <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
        Mark absent
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional), e.g. unwell"
        maxLength={200}
        className="h-9 w-56"
        aria-label="Reason for absence"
      />
      <Button size="sm" onClick={() => send(true)} disabled={busy}>
        {busy ? "Saving…" : "Confirm absent"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
