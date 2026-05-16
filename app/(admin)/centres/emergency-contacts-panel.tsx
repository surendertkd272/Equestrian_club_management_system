"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Contact = { label: string; number: string; type: string };
const TYPES: Contact["type"][] = ["vet", "ambulance", "police", "fire", "manager", "other"];

export function EmergencyContactsPanel({
  centreId,
  initial,
}: {
  centreId: string;
  initial: Contact[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Contact[]>(initial.length ? initial : []);
  const [busy, setBusy] = useState(false);

  function add() {
    setRows((r) => [...r, { label: "", number: "", type: "vet" }]);
  }
  function update(i: number, patch: Partial<Contact>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function remove(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  async function save() {
    // Drop empty rows on save — easier than maintaining a dirty flag.
    const cleaned = rows
      .map((r) => ({ label: r.label.trim(), number: r.number.trim(), type: r.type }))
      .filter((r) => r.label && r.number);

    setBusy(true);
    try {
      const res = await fetch(`/api/centres/${centreId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emergencyContacts: cleaned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success("Emergency contacts saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No emergency contacts yet. Add at least the on-call vet and nearest equine
          hospital — these show up on every staff member's dashboard.
        </p>
      )}

      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <select
            value={row.type}
            onChange={(e) => update(i, { type: e.target.value })}
            className="col-span-2 h-9 rounded-md border border-input bg-background px-2 text-xs uppercase tracking-wide"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <Input
            value={row.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="Dr. Ramesh (24/7 vet)"
            className="col-span-5"
          />
          <Input
            value={row.number}
            onChange={(e) => update(i, { number: e.target.value })}
            placeholder="+91 98765 43210"
            className="col-span-4 font-mono"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="col-span-1 text-xs text-muted-foreground hover:text-destructive"
            aria-label="Remove"
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" onClick={add} size="sm">
          + Add contact
        </Button>
        <Button type="button" onClick={save} disabled={busy} size="sm">
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
