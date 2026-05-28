"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Initial = {
  name: string;
  contactName: string;
  billingEmail: string;
  phone: string;
  status: string;
};

export function TenantEditForm({ id, initial }: { id: string; initial: Initial }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [contactName, setContactName] = useState(initial.contactName);
  const [billingEmail, setBillingEmail] = useState(initial.billingEmail);
  const [phone, setPhone] = useState(initial.phone);
  const [status, setStatus] = useState(initial.status);
  const [busy, setBusy] = useState(false);

  const dirty =
    name !== initial.name ||
    contactName !== initial.contactName ||
    billingEmail !== initial.billingEmail ||
    phone !== initial.phone ||
    status !== initial.status;

  async function save() {
    if (!dirty) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/tenants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name !== initial.name ? name : undefined,
          contactName: contactName !== initial.contactName ? contactName : undefined,
          billingEmail: billingEmail !== initial.billingEmail ? billingEmail : undefined,
          phone: phone !== initial.phone ? phone : undefined,
          status: status !== initial.status ? status : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setName(initial.name);
    setContactName(initial.contactName);
    setBillingEmail(initial.billingEmail);
    setPhone(initial.phone);
    setStatus(initial.status);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={`t-name-${id}`} className="text-slate-300">Tenant name</Label>
        <Input
          id={`t-name-${id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border-slate-700 bg-slate-950 text-slate-100"
        />
      </div>
      <div>
        <Label htmlFor={`t-contact-${id}`} className="text-slate-300">Contact name</Label>
        <Input
          id={`t-contact-${id}`}
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          className="border-slate-700 bg-slate-950 text-slate-100"
        />
      </div>
      <div>
        <Label htmlFor={`t-billing-${id}`} className="text-slate-300">Billing email</Label>
        <Input
          id={`t-billing-${id}`}
          type="email"
          value={billingEmail}
          onChange={(e) => setBillingEmail(e.target.value)}
          className="border-slate-700 bg-slate-950 text-slate-100"
        />
      </div>
      <div>
        <Label htmlFor={`t-phone-${id}`} className="text-slate-300">Phone</Label>
        <Input
          id={`t-phone-${id}`}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="border-slate-700 bg-slate-950 text-slate-100"
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`t-status-${id}`} className="text-slate-300">Status</Label>
        <select
          id={`t-status-${id}`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
        >
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="past_due">Past due</option>
          <option value="suspended">Suspended</option>
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Phase 7 wires read-only mode for past_due / suspended. For now this is metadata only.
        </p>
      </div>
      <div className="sm:col-span-2 flex gap-2">
        <Button onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        {dirty && (
          <Button variant="outline" onClick={reset} disabled={busy} className="border-slate-700 text-slate-200 hover:bg-slate-800">
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
