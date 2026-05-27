"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { VENDOR_CATEGORIES, VENDOR_CATEGORY_LABEL } from "@/lib/schemas/vendor";

export function NewVendorForm({
  centres,
  pinnedCentreId,
}: {
  centres: { id: string; name: string }[];
  pinnedCentreId: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    category: "vet" as (typeof VENDOR_CATEGORIES)[number],
    contactName: "",
    phone: "",
    email: "",
    address: "",
    gstin: "",
    notes: "",
    centreId: pinnedCentreId ?? centres[0]?.id ?? "",
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.centreId) {
      toast.error("Pick a centre.");
      return;
    }
    setBusy(true);
    // POST goes to the existing /api/vendors which now persists category +
    // address. When pinnedCentreId is set (HQ filter active), the API will
    // ignore body.centreId and use the session scope; we still send it
    // for the SUPER_ADMIN "all centres" case where there's no scope.
    const res = await fetch("/api/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        email: form.email || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed");
      return;
    }
    toast.success("Vendor added");
    setForm((f) => ({ ...f, name: "", contactName: "", phone: "", email: "", address: "", gstin: "", notes: "" }));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Name *</Label>
        <Input required value={form.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Category *</Label>
        <Select value={form.category} onChange={(e) => set("category", e.target.value as typeof form.category)}>
          {VENDOR_CATEGORIES.map((c) => (
            <option key={c} value={c}>{VENDOR_CATEGORY_LABEL[c]}</option>
          ))}
        </Select>
      </div>
      {!pinnedCentreId && centres.length > 1 && (
        <div className="space-y-1.5 md:col-span-2">
          <Label>Centre *</Label>
          <Select value={form.centreId} onChange={(e) => set("centreId", e.target.value)}>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Contact person</Label>
        <Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Phone</Label>
        <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit" />
      </div>
      <div className="space-y-1.5">
        <Label>Email</Label>
        <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>GSTIN</Label>
        <Input value={form.gstin} onChange={(e) => set("gstin", e.target.value)} />
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label>Address</Label>
        <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label>Notes</Label>
        <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="On-call hours, preferred contact, etc." />
      </div>
      <Button type="submit" disabled={busy} className="md:col-span-2 w-full">
        {busy ? "Adding…" : "Add vendor"}
      </Button>
    </form>
  );
}
