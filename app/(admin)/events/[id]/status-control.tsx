"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Select } from "@/components/ui/select";

const NEXT_STATES: Record<string, string[]> = {
  draft: ["open", "cancelled"],
  open: ["live", "cancelled"],
  live: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function EventStatusControl({ id, currentStatus }: { id: string; currentStatus: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = NEXT_STATES[currentStatus] ?? [];
  if (next.length === 0) return null;

  async function set(status: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        toast.error("Failed");
        return;
      }
      toast.success(`Status → ${status}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Select
      defaultValue=""
      disabled={busy}
      onChange={(e) => {
        if (e.target.value) set(e.target.value);
      }}
      className="h-8 w-auto text-xs"
    >
      <option value="">Advance…</option>
      {next.map((s) => (
        <option key={s} value={s}>
          → {s}
        </option>
      ))}
    </Select>
  );
}
