"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TACK_SUBCATEGORIES, SCHOOL_SUBCATEGORIES } from "@/lib/schemas/asset";

type Centre = { id: string; name: string };

export function NewAssetForm({
  centres = [],
  isSuperAdmin = false,
}: {
  centres?: Centre[];
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    category: "tack",
    subcategory: "saddle",
    name: "",
    brand: "",
    purchaseDate: today,
    cost: "",
    notes: "",
    // Only used when SUPER_ADMIN is creating; the API picks session.centreId
    // when this is blank.
    centreId: "",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const subOptions = useMemo(
    () => (form.category === "tack" ? TACK_SUBCATEGORIES : SCHOOL_SUBCATEGORIES),
    [form.category],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSuperAdmin && !form.centreId) {
      toast.error("Pick a centre — super admins aren't scoped to one.");
      return;
    }
    setSaving(true);
    const payload: any = { ...form };
    if (!form.cost) delete payload.cost;
    if (!form.purchaseDate) delete payload.purchaseDate;
    if (!payload.centreId) delete payload.centreId;
    const res = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed");
      return;
    }
    const data = await res.json();
    toast.success(`Added · QR ${data.qrCode}`);
    router.push(`/tack/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {isSuperAdmin && (
        <div className="rounded-md border bg-muted/30 p-3">
          <Label>Centre *</Label>
          <Select value={form.centreId} onChange={(e) => set("centreId", e.target.value)} required>
            <option value="">— Pick which club this item belongs to —</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            You're signed in as HQ super admin — assets live per-centre.
          </p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Category *</Label>
          <Select
            value={form.category}
            onChange={(e) => {
              const cat = e.target.value;
              setForm((f) => ({
                ...f,
                category: cat,
                subcategory: cat === "tack" ? "saddle" : "show_jump",
              }));
            }}
          >
            <option value="tack">Tack</option>
            <option value="school_equipment">School equipment</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Sub-category</Label>
          <Select value={form.subcategory} onChange={(e) => set("subcategory", e.target.value)}>
            {subOptions.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Name *</Label>
          <Input
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Wintec All-Purpose Saddle · Stable A · Helmet #4"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Brand</Label>
          <Input value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Wintec / Charles Owen" />
        </div>
        <div className="space-y-1.5">
          <Label>Purchase date</Label>
          <Input type="date" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Cost (₹)</Label>
          <Input
            type="number"
            min={0}
            value={form.cost}
            onChange={(e) => set("cost", e.target.value)}
            placeholder="25000"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </div>
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Adding…" : "Add asset (auto-generate QR)"}
      </Button>
    </form>
  );
}
