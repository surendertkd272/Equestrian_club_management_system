"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const ROLE_OPTIONS = [
  { value: "COACH", label: "Coach" },
  { value: "GROOM", label: "Groom" },
  { value: "STABLE_MANAGER", label: "Stable Manager" },
  { value: "INVENTORY_MANAGER", label: "Inventory Manager" },
  { value: "VET", label: "Vet" },
  { value: "FARRIER", label: "Farrier" },
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "COMPETITION_MANAGER", label: "Competition Manager" },
];

export function StaffRegisterForm({
  code,
  centreName,
  invitedEmail = null,
  invitedName = null,
  invitedRole = null,
}: {
  code: string;
  centreName: string;
  invitedEmail?: string | null;
  invitedName?: string | null;
  invitedRole?: string | null;
}) {
  const [form, setForm] = useState({
    name: invitedName ?? "",
    email: invitedEmail ?? "",
    phone: "",
    // If the invite carries a role we recognise, default to it; else Coach.
    role: invitedRole && ROLE_OPTIONS.some((r) => r.value === invitedRole) ? invitedRole : "COACH",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/staff-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, code }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="space-y-3 text-sm">
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
          <div className="font-semibold">Submitted!</div>
          <p className="mt-1">
            Thanks. {centreName} admin will review your details and email you when your account is
            activated. You can close this tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label>Full name *</Label>
        <Input required value={form.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Email *</Label>
        <Input
          required
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          readOnly={!!invitedEmail}
          className={invitedEmail ? "bg-muted cursor-not-allowed" : undefined}
        />
        {invitedEmail && (
          <p className="text-xs text-muted-foreground">This invite is locked to {invitedEmail}.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Phone</Label>
        <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit" />
      </div>
      <div className="space-y-1.5">
        <Label>Role you're joining as *</Label>
        <Select
          value={form.role}
          onChange={(e) => set("role", e.target.value)}
          disabled={!!invitedRole}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </Select>
        {invitedRole && (
          <p className="text-xs text-muted-foreground">Set by the admin who invited you.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Notes (optional)</Label>
        <Input
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Anything the admin should know"
        />
      </div>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Submitting…" : "Submit for approval"}
      </Button>
    </form>
  );
}
