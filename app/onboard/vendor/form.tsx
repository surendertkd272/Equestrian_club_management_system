"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { VENDOR_CATEGORIES, VENDOR_CATEGORY_LABEL } from "@/lib/schemas/vendor";

export function VendorRegistrationForm({ centreSlug, centreName }: { centreSlug: string; centreName: string }) {
  const [f, setF] = useState({
    name: "",
    category: "feed" as (typeof VENDOR_CATEGORIES)[number],
    contactName: "",
    phone: "",
    email: "",
    address: "",
    gstin: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: string) {
    setF((p) => ({ ...p, [k]: v }));
  }

  const canSubmit = f.name.trim().length >= 2 && f.phone.trim().length >= 7 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      let res: Response;
      try {
        res = await fetch("/api/vendor-registration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ centreSlug, ...f }),
        });
      } catch {
        toast.error("Couldn't reach the server — check your connection and try again.");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) toast.error("Too many submissions — please try again later.");
        else {
          const flat = data?.details?.fieldErrors as Record<string, string[]> | undefined;
          const first = flat ? Object.entries(flat).flatMap(([k, v]) => v.map((m) => `${k}: ${m}`))[0] : undefined;
          toast.error(first ?? data.error ?? "Submission failed");
        }
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-bold">Thank you!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your business has been submitted to {centreName} for review. They&apos;ll be in touch.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Business / Vendor Name *</Label>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} required placeholder="e.g. Sharma Feed Suppliers" />
        </div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={f.category} onChange={(e) => set("category", e.target.value)}>
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c} value={c}>{VENDOR_CATEGORY_LABEL[c]}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Contact Person</Label>
          <Input value={f.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Full name" />
        </div>
        <div className="space-y-1.5">
          <Label>Phone *</Label>
          <Input value={f.phone} onChange={(e) => set("phone", e.target.value)} required placeholder="10-digit mobile" inputMode="tel" />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="you@business.com" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Address</Label>
          <Input value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Business address" />
        </div>
        <div className="space-y-1.5">
          <Label>GSTIN</Label>
          <Input value={f.gstin} onChange={(e) => set("gstin", e.target.value)} placeholder="Optional" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes</Label>
          <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="What do you supply? Any details the club should know." />
        </div>
      </div>
      <Button type="submit" disabled={!canSubmit} className="w-full">
        {busy ? "Submitting…" : "Submit registration"}
      </Button>
    </form>
  );
}
