"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";

type Item = { name: string; qty: string; unit: string; estimatedUnitCost: string; notes: string };

const EMPTY_ITEM: Item = { name: "", qty: "1", unit: "", estimatedUnitCost: "", notes: "" };

export function NewRequisitionForm({
  centres = [],
}: {
  // Non-empty only for SUPER_ADMIN — picker resolves which centre owns
  // the requisition. Hidden for centre-scoped roles.
  centres?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<Item[]>([{ ...EMPTY_ITEM }]);
  const [centreId, setCentreId] = useState(centres[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  function updateItem(idx: number, patch: Partial<Item>) {
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const total = items.reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.estimatedUnitCost) || 0),
    0,
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = items
      .filter((it) => it.name.trim() && Number(it.qty) > 0)
      .map((it) => ({
        name: it.name.trim(),
        qty: Number(it.qty),
        unit: it.unit.trim() || undefined,
        estimatedUnitCost: Number(it.estimatedUnitCost) || 0,
        notes: it.notes.trim() || undefined,
      }));
    if (cleaned.length === 0) {
      toast.error("Add at least one item with a name and qty.");
      return;
    }
    if (centres.length > 0 && !centreId) {
      toast.error("Pick a centre for this requisition.");
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      items: cleaned,
      reason: reason.trim() || undefined,
    };
    // SUPER_ADMIN must include centreId; centre-scoped users omit it and
    // the API uses session.centreId instead.
    if (centres.length > 0) payload.centreId = centreId;
    const res = await fetch("/api/requisitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Surface Zod's per-field complaints when the API returns them — the
      // generic "VALIDATION" string alone made it impossible to tell which
      // field was off (saw this with single-char item names).
      const flat = err?.details?.fieldErrors as Record<string, string[]> | undefined;
      const firstFieldMsg = flat
        ? Object.entries(flat).flatMap(([k, v]) => v.map((m) => `${k}: ${m}`))[0]
        : undefined;
      toast.error(firstFieldMsg ?? err.error ?? "Failed");
      return;
    }
    toast.success("Requisition submitted");
    router.push("/requisitions");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {centres.length > 0 && (
        <div className="space-y-1.5">
          <Label>Centre *</Label>
          <Select aria-label="Centre" value={centreId} onChange={(e) => setCentreId(e.target.value)}>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <p className="text-[11px] text-muted-foreground">
            HQ admins must pick which club this requisition belongs to.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Reason / context</Label>
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={"e.g. \"Bijli's monthly hoof care + restock of dewormer for the herd.\""}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Items *</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setItems((rows) => [...rows, { ...EMPTY_ITEM }])}
          >
            <Plus className="mr-1 h-4 w-4" /> Add row
          </Button>
        </div>

        {items.map((it, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-3 md:grid-cols-12">
            <div className="md:col-span-5">
              <Input
                placeholder="Item name *"
                value={it.name}
                onChange={(e) => updateItem(i, { name: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Qty *"
                value={it.qty}
                onChange={(e) => updateItem(i, { qty: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Input
                placeholder="Unit (kg, box…)"
                value={it.unit}
                onChange={(e) => updateItem(i, { unit: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Est. ₹/unit"
                value={it.estimatedUnitCost}
                onChange={(e) => updateItem(i, { estimatedUnitCost: e.target.value })}
              />
            </div>
            <div className="md:col-span-1 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove item"
                onClick={() => setItems((rows) => rows.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="md:col-span-12">
              <Input
                placeholder="Notes (optional)"
                value={it.notes}
                onChange={(e) => updateItem(i, { notes: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-md bg-muted/40 p-3 text-right text-sm">
        <span className="text-muted-foreground">Estimated total:</span>{" "}
        <span className="font-semibold">
          ₹{total.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
        </span>
      </div>

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Submitting…" : "Submit requisition"}
      </Button>
    </form>
  );
}
