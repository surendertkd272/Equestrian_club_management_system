"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

// HR-record edit form for an existing staff member. Only the fields this
// endpoint owns — name, phone, salary band, date of joining. Email, role and
// account status are edited on the HQ Users admin page (linked from the header).
type FormState = {
  name: string;
  phone: string;
  salaryBand: string;
  joiningDate: string;
};

export function EditStaffForm({ id, initial }: { id: string; initial: FormState }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);

  const dirtyKeys = useMemo(
    () => (Object.keys(state) as (keyof FormState)[]).filter((k) => state[k] !== initial[k]),
    [state, initial],
  );
  const dirty = dirtyKeys.length > 0;
  useUnsavedChanges(dirty && !busy);

  function set<K extends keyof FormState>(k: K, v: string) {
    setState((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    if (!dirty) return;
    if (!state.name.trim()) return toast.error("Name is required");

    // Send only the changed keys. joiningDate maps to a required Date column, so
    // don't send it blank — just leave it unchanged if the picker was cleared.
    const payload: Record<string, unknown> = {};
    for (const k of dirtyKeys) {
      if (k === "joiningDate" && !state.joiningDate.trim()) continue;
      payload[k] = state[k];
    }
    if (Object.keys(payload).length === 0) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "VALIDATION" && data.details?.fieldErrors) {
          const first = Object.entries(data.details.fieldErrors).find(([, v]) => Array.isArray(v) && v.length);
          if (first) {
            const [field, msgs] = first as [string, string[]];
            toast.error(`${field}: ${msgs[0]}`);
            return;
          }
        }
        toast.error(data.error ?? "Failed to save");
        return;
      }
      toast.success("Staff updated");
      router.push(`/staff/${id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Name *</Label>
          <Input aria-label="Name" value={state.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input aria-label="Phone" value={state.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit" />
        </div>
        <div className="space-y-1.5">
          <Label>Salary Band</Label>
          <Input aria-label="Salary band" value={state.salaryBand} onChange={(e) => set("salaryBand", e.target.value)} placeholder="e.g. L3" />
        </div>
        <div className="space-y-1.5">
          <Label>Date of Joining</Label>
          <Input aria-label="Date of joining" type="date" value={state.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} />
          <p className="text-xs text-muted-foreground">Set the real joining date for staff who were part of the club before this registration.</p>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t pt-4">
        <Button onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : dirty ? `Save (${dirtyKeys.length} change${dirtyKeys.length === 1 ? "" : "s"})` : "No changes"}
        </Button>
        <a
          href={`/staff/${id}`}
          className="rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          Cancel
        </a>
      </div>
    </div>
  );
}
