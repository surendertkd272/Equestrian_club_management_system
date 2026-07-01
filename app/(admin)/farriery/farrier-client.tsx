"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Horse = { id: string; name: string; stableNo: string | null };

export function FarrierClient({ horses }: { horses: Horse[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    horseId: horses[0]?.id ?? "",
    farrierName: "",
    scheduledAt: "",
    workType: "trim",
    hoofNotes: "",
    cost: "",
  });
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  async function schedule() {
    if (!form.horseId || !form.farrierName || !form.scheduledAt) {
      toast.error("Horse, farrier and date are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/farrier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          horseId: form.horseId,
          farrierName: form.farrierName,
          scheduledAt: form.scheduledAt,
          workType: form.workType,
          hoofNotes: form.hoofNotes || undefined,
          cost: form.cost ? Number(form.cost) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Visit scheduled");
      setForm((f) => ({ ...f, scheduledAt: "", hoofNotes: "", cost: "" }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Schedule a Visit</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Horse</Label>
            <Select aria-label="Horse" value={form.horseId} onChange={(e) => set("horseId", e.target.value)}>
              {horses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}{h.stableNo ? ` (${h.stableNo})` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Farrier Name</Label>
            <Input aria-label="Farrier name" value={form.farrierName} onChange={(e) => set("farrierName", e.target.value)} />
          </div>
          <div>
            <Label>Date</Label>
            <Input aria-label="Date" type="date" value={form.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} />
          </div>
          <div>
            <Label>Work</Label>
            <Select aria-label="Work" value={form.workType} onChange={(e) => set("workType", e.target.value)}>
              <option value="trim">Trim Only</option>
              <option value="hoofing">Hoofing</option>
              <option value="new_horse_shoe">New Horse Shoe</option>
              <option value="shoe_full">Shoe (Full Set)</option>
              <option value="shoe_partial">Shoe (Partial)</option>
              <option value="reset">Reset Existing Shoes</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div>
            <Label>Cost (₹, optional)</Label>
            <Input aria-label="Cost (₹, optional)" type="number" value={form.cost} onChange={(e) => set("cost", e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Input aria-label="Notes" value={form.hoofNotes} onChange={(e) => set("hoofNotes", e.target.value)} placeholder="left fore — slight crack" />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={schedule} disabled={busy}>{busy ? "Scheduling…" : "Schedule visit"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CompleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    const ok = await openConfirm({
      title: "Mark visit completed?",
      body: "Next-due will be set to +6 weeks from today.",
      confirmLabel: "Mark completed",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/farrier/${id}/complete`, { method: "POST", body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Completed");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={go} disabled={busy}>
      {busy ? "…" : "Complete"}
    </Button>
  );
}
