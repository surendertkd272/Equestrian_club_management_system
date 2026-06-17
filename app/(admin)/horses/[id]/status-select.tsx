"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";

export function StatusSelect({ horseId, currentStatus }: { horseId: string; currentStatus: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === currentStatus) return;
    setSaving(true);
    const res = await patchJson(`/api/horses/${horseId}`, { status: next });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
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
