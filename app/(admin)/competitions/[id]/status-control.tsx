"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { COMPETITION_STATUSES } from "@/lib/schemas/competition";

export function StatusControl({ id, currentStatus }: { id: string; currentStatus: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === currentStatus) return;
    setSaving(true);
    const res = await fetch(`/api/competitions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error("Failed");
      return;
    }
    toast.success(`Status → ${next.replaceAll("_", " ")}`);
    router.refresh();
  }

  return (
    <select
      defaultValue={currentStatus}
      onChange={onChange}
      disabled={saving}
      className="h-7 rounded-md border border-input bg-background px-2 text-xs"
    >
      {COMPETITION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}
