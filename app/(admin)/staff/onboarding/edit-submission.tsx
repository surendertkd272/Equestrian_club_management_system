"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type SubmissionInitial = {
  fullName: string;
  email: string;
  fatherName: string;
  emergencyContact: string;
  dob: string;
  permanentAddress: string;
  maritalStatus: string;
  panNumber: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  agreedSalary: string;
  foodCharges: string;
  employmentType: string;
  dateOfJoining: string;
  references: string;
};

// Correct a wrong SUBMITTED registration before approving it. Text/detail
// fields only (documents can be re-uploaded by the employee after approval, or
// via the staff record). Aadhaar number is left blank on purpose — fill it only
// to replace the stored (encrypted) value.
export function EditSubmission({ id, initial }: { id: string; initial: SubmissionInitial }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<SubmissionInitial & { aadhaarNumber: string }>({ ...initial, aadhaarNumber: "" });

  function set<K extends keyof typeof f>(k: K, v: string) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    if (!f.fullName.trim()) return toast.error("Full name required.");
    setBusy(true);
    try {
      // Partial edit: only send fields that have a value. Blank fields are
      // left out so the PATCH route preserves the stored value (rather than
      // nulling it) — and so empty enum/email fields don't fail validation.
      // Blank aadhaarNumber is therefore naturally dropped (= keep existing).
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) {
        if (typeof v === "string" && v.trim() === "") continue;
        payload[k] = v;
      }
      const res = await fetch(`/api/staff-onboarding/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed to save");
        return;
      }
      toast.success("Registration updated");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-primary hover:underline">
        Edit details
      </button>
    );
  }

  const T = (k: keyof SubmissionInitial, label: string, extra?: { type?: string }) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input aria-label={label} type={extra?.type ?? "text"} value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <div className="mt-3 grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-2">
      {T("fullName", "Full name")}
      {T("email", "Email", { type: "email" })}
      {T("fatherName", "Father's name")}
      {T("emergencyContact", "Emergency contact")}
      {T("dob", "Date of birth", { type: "date" })}
      {T("dateOfJoining", "Date of joining", { type: "date" })}
      <div>
        <Label className="text-xs">Marital status</Label>
        <Select aria-label="Marital status" value={f.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)}>
          <option value="">—</option>
          <option value="single">Single</option>
          <option value="married">Married</option>
          <option value="other">Other</option>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Employment type</Label>
        <Select aria-label="Employment type" value={f.employmentType} onChange={(e) => set("employmentType", e.target.value)}>
          <option value="">—</option>
          <option value="full_time">Full time</option>
          <option value="trainee_stipend">Trainee (stipend)</option>
        </Select>
      </div>
      <div className="sm:col-span-2">{T("permanentAddress", "Permanent address")}</div>
      <div>
        <Label className="text-xs">Aadhaar number <span className="text-muted-foreground">(blank = keep)</span></Label>
        <Input aria-label="Aadhaar number" value={f.aadhaarNumber} onChange={(e) => set("aadhaarNumber", e.target.value.replace(/\D/g, ""))} maxLength={12} placeholder="Leave blank to keep existing" />
      </div>
      {T("panNumber", "PAN number")}
      {T("bankName", "Bank name")}
      {T("bankAccountName", "Account holder")}
      {T("bankAccountNumber", "Account number")}
      {T("bankIfsc", "IFSC")}
      {T("agreedSalary", "Agreed salary (₹)", { type: "number" })}
      {T("foodCharges", "Food charges (₹)", { type: "number" })}
      <div className="sm:col-span-2">{T("references", "References")}</div>
      <div className="flex gap-2 sm:col-span-2">
        <Button size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
