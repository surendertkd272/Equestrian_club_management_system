"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";

type Config = {
  legalName: string;
  gstin: string | null;
  hsnCode: string | null;
  panNo: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  billingEmail: string | null;
  supportEmail: string | null;
  invoicePrefix: string;
  defaultTaxBps: number;
};

export function BillingConfigForm({ initial }: { initial: Config }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Config>(k: K, v: Config[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setBusy(true);
    const res = await patchJson("/api/owner/platform-billing", form);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Saved.");
    router.refresh();
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Legal Entity Name" value={form.legalName} onChange={(v) => set("legalName", v)} />
      <Field label="GSTIN (15 Chars)" value={form.gstin ?? ""} onChange={(v) => set("gstin", v || null)} placeholder="29ABCDE1234F1Z5" />
      <Field label="HSN / SAC Code" value={form.hsnCode ?? ""} onChange={(v) => set("hsnCode", v || null)} placeholder="9984" />
      <Field label="PAN" value={form.panNo ?? ""} onChange={(v) => set("panNo", v || null)} placeholder="ABCDE1234F" />
      <Field label="Address Line 1" value={form.addressLine1 ?? ""} onChange={(v) => set("addressLine1", v || null)} />
      <Field label="Address Line 2" value={form.addressLine2 ?? ""} onChange={(v) => set("addressLine2", v || null)} />
      <Field label="City" value={form.city ?? ""} onChange={(v) => set("city", v || null)} />
      <Field label="State" value={form.state ?? ""} onChange={(v) => set("state", v || null)} placeholder="Karnataka" />
      <Field label="Pincode" value={form.pincode ?? ""} onChange={(v) => set("pincode", v || null)} />
      <Field label="Country" value={form.country} onChange={(v) => set("country", v)} />
      <Field label="Billing Email" value={form.billingEmail ?? ""} onChange={(v) => set("billingEmail", v || null)} type="email" />
      <Field label="Support Email" value={form.supportEmail ?? ""} onChange={(v) => set("supportEmail", v || null)} type="email" />
      <Field label="Invoice Prefix" value={form.invoicePrefix} onChange={(v) => set("invoicePrefix", v)} placeholder="EW" />
      <div>
        <Label className="text-xs text-muted-foreground">Default GST rate (basis points)</Label>
        <Input aria-label="Default GST rate (basis points)"
          type="number"
          value={form.defaultTaxBps}
          onChange={(e) => set("defaultTaxBps", Number(e.target.value))}
          className="border-border bg-background text-foreground"
        />
        <div className="mt-1 text-xs text-muted-foreground">1800 = 18% (current SaaS GST rate in India)</div>
      </div>
      <div className="md:col-span-2 flex justify-end">
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-border bg-background text-foreground"
      />
    </div>
  );
}
