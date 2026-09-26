"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";

export function StatusSelect({ horseId, currentStatus }: { horseId: string; currentStatus: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const select = e.target;
    const next = select.value;
    if (next === currentStatus) return;
    setSaving(true);
    const res = await patchJson<{ pending?: boolean }>(`/api/horses/${horseId}`, { status: next });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      select.value = currentStatus;
      return;
    }
    if (res.data?.pending) {
      // A coach's status change waits for a manager — put the dropdown back to
      // the real status rather than show one the horse doesn't have yet.
      select.value = currentStatus;
      toast.info(`Status change to "${next}" sent to a manager for approval.`);
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
      <option value="active">Active</option>
      <option value="rest">Rest</option>
      <option value="retired">Retired</option>
    </select>
  );
}
