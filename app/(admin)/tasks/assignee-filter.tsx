"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { roleLabel } from "@/lib/labels";
type Assignee = { id: string; name: string; role: string };

// Userwise filter for the task board. Navigates with ?assignee=<id> (or the
// "unassigned" sentinel). Kept client-side so the select auto-submits on
// change without a separate "Filter" button.
export function AssigneeFilter({ assignees }: { assignees: Assignee[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("assignee") ?? "";

  function go(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("assignee", value);
    else next.delete("assignee");
    // Switching assignee clears the "mine" toggle so they don't conflict.
    next.delete("mine");
    router.push(`/tasks${next.toString() ? `?${next.toString()}` : ""}`);
  }

  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
        Assignee
      </label>
      <select
        value={current}
        onChange={(e) => go(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Everyone</option>
        <option value="unassigned">Unassigned</option>
        {assignees.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {roleLabel(u.role)}
          </option>
        ))}
      </select>
    </div>
  );
}
