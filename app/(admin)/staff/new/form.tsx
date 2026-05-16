"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ASSIGNABLE_STAFF_ROLES } from "@/lib/schemas/staff";

export function NewStaffForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "COACH",
    salaryBand: "",
    password: "password123",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error === "EMAIL_IN_USE" ? "Email already in use" : err.error ?? "Failed");
      return;
    }
    toast.success("Staff added");
    router.push("/staff");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Name *</Label>
          <Input required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Email *</Label>
          <Input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit" />
        </div>
        <div className="space-y-1.5">
          <Label>Role *</Label>
          <Select value={form.role} onChange={(e) => set("role", e.target.value)}>
            {ASSIGNABLE_STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Salary band</Label>
          <Input value={form.salaryBand} onChange={(e) => set("salaryBand", e.target.value)} placeholder="e.g. L3" />
        </div>
        <div className="space-y-1.5">
          <Label>Initial password</Label>
          <Input value={form.password} onChange={(e) => set("password", e.target.value)} />
        </div>
      </div>
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Creating…" : "Create staff"}
      </Button>
    </form>
  );
}
