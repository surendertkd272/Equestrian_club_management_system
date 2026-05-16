"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function StatusSelect({ horseId, currentStatus }: { horseId: string; currentStatus: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === currentStatus) return;
    setSaving(true);
    const res = await fetch(`/api/horses/${horseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error("Failed");
      return;
    }
    toast.success(`Status → ${next}`);
    router.refresh();
  }

  return (
    <select
      defaultValue={currentStatus}
      onChange={onChange}
      disabled={saving}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value="active">active</option>
      <option value="rest">rest</option>
      <option value="retired">retired</option>
    </select>
  );
}
