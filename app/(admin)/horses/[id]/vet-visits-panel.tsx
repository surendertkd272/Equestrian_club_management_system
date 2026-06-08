"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";

type Prescription = {
  id?: string;
  medicineId: string | null;
  medicineName: string;
  dose: string;
  route: "oral" | "im" | "iv" | "topical" | "";
  durationDays: string;
  frequency: string;
  notes: string;
};

export type VetVisitDTO = {
  id: string;
  visitDate: string; // ISO
  reason: string | null;
  notes: string;
  followUpAt: string | null;
  vet: { id: string; name: string };
  prescriptions: {
    id: string;
    medicineId: string | null;
    medicineName: string;
    dose: string;
    route: string | null;
    durationDays: number | null;
    frequency: string | null;
    notes: string | null;
  }[];
};

export type MedicineOption = {
  id: string;
  name: string;
  qty: number;
};

const EMPTY_RX: Prescription = {
  medicineId: null,
  medicineName: "",
  dose: "",
  route: "",
  durationDays: "",
  frequency: "",
  notes: "",
};

export function VetVisitsPanel({
  horseId,
  initial,
  medicines,
  canWrite,
}: {
  horseId: string;
  initial: VetVisitDTO[];
  medicines: MedicineOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [visits, setVisits] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([{ ...EMPTY_RX }]);

  const medById = useMemo(
    () => Object.fromEntries(medicines.map((m) => [m.id, m])),
    [medicines],
  );

  function resetForm() {
    setReason("");
    setNotes("");
    setFollowUpAt("");
    setPrescriptions([{ ...EMPTY_RX }]);
  }

  function updateRx(idx: number, patch: Partial<Prescription>) {
    setPrescriptions((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function onPickMedicine(idx: number, medId: string) {
    if (!medId) {
      updateRx(idx, { medicineId: null });
      return;
    }
    const m = medById[medId];
    if (!m) return;
    updateRx(idx, { medicineId: medId, medicineName: m.name });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!notes.trim()) {
      toast.error("Notes are required");
      return;
    }
    // Drop any rows the user opened but never filled in.
    const cleaned = prescriptions
      .filter((p) => p.medicineName.trim() && p.dose.trim())
      .map((p) => ({
        medicineId: p.medicineId,
        medicineName: p.medicineName.trim(),
        dose: p.dose.trim(),
        route: p.route || null,
        durationDays: p.durationDays ? Number(p.durationDays) : null,
        frequency: p.frequency.trim() || null,
        notes: p.notes.trim() || null,
      }));

    setSaving(true);
    const res = await fetch(`/api/horses/${horseId}/vet-visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: reason.trim() || null,
        notes: notes.trim(),
        followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
        prescriptions: cleaned,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to save");
      return;
    }
    const data = await res.json();
    setVisits((v) => [data.visit, ...v]);
    resetForm();
    setAdding(false);
    toast.success("Visit recorded");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {visits.length} visit{visits.length === 1 ? "" : "s"} on record
          </div>
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Record visit
            </Button>
          )}
        </div>
      )}

      {adding && (
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-md border bg-card p-4"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Reason / chief complaint</Label>
              <Input aria-label="Reason / chief complaint"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. lameness, cough, post-op check"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Follow-up date</Label>
              <Input aria-label="Follow-up date"
                type="date"
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Findings & diagnosis *</Label>
            <textarea
              required
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="What you observed, examined, diagnosed."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Prescriptions</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPrescriptions((rows) => [...rows, { ...EMPTY_RX }])
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Add row
              </Button>
            </div>
            {prescriptions.length === 0 && (
              <div className="text-xs text-muted-foreground">No prescriptions for this visit.</div>
            )}
            {prescriptions.map((p, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-md border p-3 md:grid-cols-12"
              >
                <div className="md:col-span-4">
                  <Select
                    value={p.medicineId ?? ""}
                    onChange={(e) => onPickMedicine(i, e.target.value)}
                  >
                    <option value="">— free text below —</option>
                    {medicines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.qty <= 5 ? `(low: ${m.qty})` : `(${m.qty})`}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="md:col-span-4">
                  <Input
                    placeholder="Medicine name *"
                    value={p.medicineName}
                    onChange={(e) => updateRx(i, { medicineName: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <Input
                    placeholder="Dose *"
                    value={p.dose}
                    onChange={(e) => updateRx(i, { dose: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove prescription"
                    onClick={() =>
                      setPrescriptions((rows) => rows.filter((_, idx) => idx !== i))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="md:col-span-3">
                  <Select
                    value={p.route}
                    onChange={(e) =>
                      updateRx(i, { route: e.target.value as Prescription["route"] })
                    }
                  >
                    <option value="">Route…</option>
                    <option value="oral">Oral</option>
                    <option value="im">IM</option>
                    <option value="iv">IV</option>
                    <option value="topical">Topical</option>
                  </Select>
                </div>
                <div className="md:col-span-3">
                  <Input
                    placeholder="Frequency (e.g. BID)"
                    value={p.frequency}
                    onChange={(e) => updateRx(i, { frequency: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <Input
                    type="number"
                    placeholder="Days"
                    value={p.durationDays}
                    onChange={(e) => updateRx(i, { durationDays: e.target.value })}
                  />
                </div>
                <div className="md:col-span-4">
                  <Input
                    placeholder="Notes (optional)"
                    value={p.notes}
                    onChange={(e) => updateRx(i, { notes: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                resetForm();
                setAdding(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save visit"}
            </Button>
          </div>
        </form>
      )}

      {visits.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No vet visits recorded yet.
        </p>
      ) : (
        <ol className="space-y-3">
          {visits.map((v) => (
            <li key={v.id} className="rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-3">
                  <span className="text-sm font-semibold">{formatDate(new Date(v.visitDate))}</span>
                  {v.reason && (
                    <span className="text-sm text-muted-foreground">· {v.reason}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {v.vet.name}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm">{v.notes}</p>
              {v.prescriptions.length > 0 && (
                <div className="mt-3 space-y-1 rounded-md bg-muted/40 p-2 text-sm">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Prescribed
                  </div>
                  {v.prescriptions.map((p) => (
                    <div key={p.id} className="flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="font-medium">{p.medicineName}</span>
                      <span>· {p.dose}</span>
                      {p.route && <span>· {p.route}</span>}
                      {p.frequency && <span>· {p.frequency}</span>}
                      {p.durationDays && <span>· {p.durationDays}d</span>}
                      {!p.medicineId && (
                        <span className="text-xs italic text-amber-700">not in stock</span>
                      )}
                      {p.notes && <span className="text-xs text-muted-foreground">— {p.notes}</span>}
                    </div>
                  ))}
                </div>
              )}
              {v.followUpAt && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Follow-up: <span className="font-medium">{formatDate(new Date(v.followUpAt))}</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
