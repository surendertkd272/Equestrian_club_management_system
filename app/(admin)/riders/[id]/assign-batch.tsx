"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";

export function AssignBatch({
  riderId,
  currentBatchId,
  batches,
}: {
  riderId: string;
  currentBatchId: string | null;
  batches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value || null;
    if (next === currentBatchId) return;
    setSaving(true);
    const res = await patchJson(`/api/riders/${riderId}/batch`, { batchId: next });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(next ? "Assigned to batch" : "Removed from batch");
    router.refresh();
  }

  return (
    <select
      defaultValue={currentBatchId ?? ""}
      onChange={onChange}
      disabled={saving}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value="">Unassigned</option>
      {batches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
