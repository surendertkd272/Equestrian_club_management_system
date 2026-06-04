"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type EditableVendor = {
  id: string;
  name: string;
  deliveryScope: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  bankAccountName: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  upiId: string | null;
  notes: string | null;
};

// Edit a vendor's common details (PATCH /api/vendors/[id]). Category and the
// category-specific extras (VCI no., farrier specialisations, …) are set at
// creation; this covers the fields that actually change — contact, address,
// bank/UPI, GSTIN, notes, delivery scope.
export function EditVendor({ vendor }: { vendor: EditableVendor }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: vendor.name,
    deliveryScope: (vendor.deliveryScope === "national" ? "national" : "centre") as "centre" | "national",
    contactName: vendor.contactName ?? "",
    phone: vendor.phone ?? "",
    email: vendor.email ?? "",
    address: vendor.address ?? "",
    gstin: vendor.gstin ?? "",
    bankAccountName: vendor.bankAccountName ?? "",
    bankName: vendor.bankName ?? "",
    bankAccountNumber: vendor.bankAccountNumber ?? "",
    bankIfsc: vendor.bankIfsc ?? "",
    upiId: vendor.upiId ?? "",
    notes: vendor.notes ?? "",
  });
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v as never }));
  }

  async function save() {
    if (!form.name.trim()) return toast.error("Name required.");
    setBusy(true);
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, name: form.name.trim(), email: form.email || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Failed");
        return;
      }
      toast.success("Vendor updated");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-primary hover:underline">
        Edit
      </button>
    );
  }
  return (
    <div className="mt-2 grid gap-2 rounded-md border bg-card p-3 text-left md:grid-cols-2">
      <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
      <div>
        <Label className="text-xs">Delivery coverage</Label>
        <Select value={form.deliveryScope} onChange={(e) => set("deliveryScope", e.target.value)}>
          <option value="centre">Centre-specific</option>
          <option value="national">All-India</option>
        </Select>
      </div>
      <div><Label className="text-xs">Contact person</Label><Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} /></div>
      <div><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
      <div><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
      <div><Label className="text-xs">GSTIN</Label><Input value={form.gstin} onChange={(e) => set("gstin", e.target.value)} /></div>
      <div className="md:col-span-2"><Label className="text-xs">Address</Label><Input value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
      <div><Label className="text-xs">Account holder</Label><Input value={form.bankAccountName} onChange={(e) => set("bankAccountName", e.target.value)} /></div>
      <div><Label className="text-xs">Bank name</Label><Input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} /></div>
      <div><Label className="text-xs">Account number</Label><Input value={form.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value)} /></div>
      <div><Label className="text-xs">IFSC</Label><Input value={form.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())} maxLength={11} /></div>
      <div><Label className="text-xs">UPI ID</Label><Input value={form.upiId} onChange={(e) => set("upiId", e.target.value)} maxLength={60} /></div>
      <div className="md:col-span-2"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
