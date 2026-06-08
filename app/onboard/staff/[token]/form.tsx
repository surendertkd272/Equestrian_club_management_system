"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DocField =
  | "photoUrl"
  | "aadhaarUrl"
  | "panUrl"
  | "bankProofUrl"
  | "prevEmploymentUrl"
  | "policeVerificationUrl"
  | "characterCertUrl";

export function OnboardingForm({
  token,
  centreName,
  agreement,
  declaration,
}: {
  token: string;
  centreName: string;
  agreement: string;
  declaration: string;
}) {
  const [f, setF] = useState({
    fullName: "",
    fatherName: "",
    emergencyContact: "",
    dob: "",
    permanentAddress: "",
    email: "",
    maritalStatus: "",
    aadhaarNumber: "",
    panNumber: "",
    bankAccountName: "",
    bankAccountNumber: "",
    bankIfsc: "",
    bankName: "",
    prevEmployment: "",
    agreedSalary: "",
    foodCharges: "",
    otherAllowances: "",
    policeVerificationDetails: "",
    employmentType: "",
    dateOfJoining: "",
    references: "",
  });
  const [docs, setDocs] = useState<Record<DocField, string>>({
    photoUrl: "",
    aadhaarUrl: "",
    panUrl: "",
    bankProofUrl: "",
    prevEmploymentUrl: "",
    policeVerificationUrl: "",
    characterCertUrl: "",
  });
  const [pfEsicConsent, setPfEsicConsent] = useState(false);
  const [agreeOk, setAgreeOk] = useState(false);
  const [declareOk, setDeclareOk] = useState(false);
  const [declarationName, setDeclarationName] = useState("");
  const [uploading, setUploading] = useState<DocField | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: string) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function upload(field: DocField, file: File) {
    setUploading(field);
    try {
      const fd = new FormData();
      fd.append("kind", "onboarding_doc");
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Upload failed");
        return;
      }
      setDocs((p) => ({ ...p, [field]: data.url }));
      toast.success("Uploaded");
    } finally {
      setUploading(null);
    }
  }

  const canSubmit =
    f.fullName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(f.email) &&
    agreeOk &&
    declareOk &&
    declarationName.trim().length >= 2 &&
    !busy &&
    !uploading;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        token,
        ...f,
        ...docs,
        pfEsicConsent,
        agreementAccepted: true,
        declarationAccepted: true,
        declarationName,
      };
      // Numbers: omit when blank so the optional schema doesn't coerce "" → 0.
      if (!f.agreedSalary) delete payload.agreedSalary;
      if (!f.foodCharges) delete payload.foodCharges;
      if (!f.maritalStatus) delete payload.maritalStatus;
      if (!f.employmentType) delete payload.employmentType;
      const res = await fetch("/api/staff-onboarding/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const flat = data?.details?.fieldErrors as Record<string, string[]> | undefined;
        const first = flat ? Object.entries(flat).flatMap(([k, v]) => v.map((m) => `${k}: ${m}`))[0] : undefined;
        toast.error(first ?? data.error ?? "Submission failed");
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
          Your registration has been submitted to {centreName} for review. They&apos;ll be in touch.
        </p>
      </div>
    );
  }

  const Upload = ({ field, label }: { field: DocField; label: string }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(e) => e.target.files?.[0] && upload(field, e.target.files[0])}
        className="block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-muted file:px-2 file:py-1 file:text-xs"
      />
      {uploading === field ? (
        <span className="text-[11px] text-muted-foreground">Uploading…</span>
      ) : docs[field] ? (
        <span className="text-[11px] text-emerald-600">✓ Uploaded</span>
      ) : null}
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Registering with <span className="font-medium text-foreground">{centreName}</span>. Fields marked * are
        required. You can upload photos or PDFs (max 5MB each).
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Personal details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Full name *</Label><Input aria-label="Full name" value={f.fullName} onChange={(e) => set("fullName", e.target.value)} required /></div>
          <div className="space-y-1"><Label>Father&apos;s name</Label><Input aria-label="Father&apos;s name" value={f.fatherName} onChange={(e) => set("fatherName", e.target.value)} /></div>
          <div className="space-y-1"><Label>Emergency contact (name &amp; no.)</Label><Input aria-label="Emergency contact (name &amp; no.)" value={f.emergencyContact} onChange={(e) => set("emergencyContact", e.target.value)} /></div>
          <div className="space-y-1"><Label>Date of birth</Label><Input aria-label="Date of birth" type="date" value={f.dob} onChange={(e) => set("dob", e.target.value)} /></div>
          <div className="space-y-1"><Label>Email *</Label><Input aria-label="Email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} required /></div>
          <div className="space-y-1">
            <Label>Marital status</Label>
            <Select aria-label="Marital status" value={f.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)}>
              <option value="">—</option>
              <option value="single">Single</option>
              <option value="married">Married</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2"><Label>Permanent address</Label><Textarea aria-label="Permanent address" rows={2} value={f.permanentAddress} onChange={(e) => set("permanentAddress", e.target.value)} /></div>
          <Upload field="photoUrl" label="Passport photo" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Identity &amp; bank</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Aadhaar number</Label><Input aria-label="Aadhaar number" value={f.aadhaarNumber} onChange={(e) => set("aadhaarNumber", e.target.value)} /></div>
          <Upload field="aadhaarUrl" label="Aadhaar card" />
          <div className="space-y-1"><Label>PAN number</Label><Input aria-label="PAN number" value={f.panNumber} onChange={(e) => set("panNumber", e.target.value.toUpperCase())} /></div>
          <Upload field="panUrl" label="PAN card" />
          <div className="space-y-1"><Label>Bank name</Label><Input aria-label="Bank name" value={f.bankName} onChange={(e) => set("bankName", e.target.value)} /></div>
          <div className="space-y-1"><Label>Account holder name</Label><Input aria-label="Account holder name" value={f.bankAccountName} onChange={(e) => set("bankAccountName", e.target.value)} /></div>
          <div className="space-y-1"><Label>Account number</Label><Input aria-label="Account number" value={f.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value)} /></div>
          <div className="space-y-1"><Label>IFSC</Label><Input aria-label="IFSC" value={f.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())} /></div>
          <Upload field="bankProofUrl" label="Bank proof (cancelled cheque / passbook)" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Employment</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Employment type</Label>
            <Select aria-label="Employment type" value={f.employmentType} onChange={(e) => set("employmentType", e.target.value)}>
              <option value="">—</option>
              <option value="full_time">Full employment</option>
              <option value="trainee_stipend">Trainee on stipend</option>
            </Select>
          </div>
          <div className="space-y-1"><Label>Date of joining</Label><Input aria-label="Date of joining" type="date" value={f.dateOfJoining} onChange={(e) => set("dateOfJoining", e.target.value)} /></div>
          <div className="space-y-1"><Label>Agreed monthly salary (₹)</Label><Input aria-label="Agreed monthly salary (₹)" type="number" min={0} value={f.agreedSalary} onChange={(e) => set("agreedSalary", e.target.value)} /></div>
          <div className="space-y-1"><Label>Agreed monthly food charges (₹)</Label><Input aria-label="Agreed monthly food charges (₹)" type="number" min={0} value={f.foodCharges} onChange={(e) => set("foodCharges", e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Any other allowances agreed</Label><Input aria-label="Any other allowances agreed" value={f.otherAllowances} onChange={(e) => set("otherAllowances", e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={pfEsicConsent} onChange={(e) => setPfEsicConsent(e.target.checked)} />
            I agree to register at PF / ESIC
          </label>
          <div className="space-y-1 sm:col-span-2"><Label>Previous employment details</Label><Textarea aria-label="Previous employment details" rows={2} value={f.prevEmployment} onChange={(e) => set("prevEmployment", e.target.value)} placeholder="Employer, role, duration…" /></div>
          <Upload field="prevEmploymentUrl" label="Previous employment certificate (self-attested)" />
          <Upload field="characterCertUrl" label="Character certificate (last organisation)" />
          <div className="space-y-1 sm:col-span-2"><Label>Police verification details</Label><Input aria-label="Police verification details" value={f.policeVerificationDetails} onChange={(e) => set("policeVerificationDetails", e.target.value)} /></div>
          <Upload field="policeVerificationUrl" label="Police verification certificate" />
          <div className="space-y-1 sm:col-span-2"><Label>Two references (name &amp; contact)</Label><Textarea aria-label="Two references (name &amp; contact)" rows={2} value={f.references} onChange={(e) => set("references", e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Agreement</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-foreground">{agreement}</pre>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={agreeOk} onChange={(e) => setAgreeOk(e.target.checked)} />
            I have read and accept the agreement and conduct terms above.
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Self-declaration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-foreground">{declaration}</pre>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={declareOk} onChange={(e) => setDeclareOk(e.target.checked)} />
            I accept the self-declaration above.
          </label>
          <div className="space-y-1">
            <Label>Type your full name to accept (legal e-signature) *</Label>
            <Input aria-label="Type your full name to accept (legal e-signature)" value={declarationName} onChange={(e) => setDeclarationName(e.target.value)} placeholder="Your full legal name" />
          </div>
        </CardContent>
      </Card>

      <Button type="submit" disabled={!canSubmit} className="w-full">
        {busy ? "Submitting…" : "Submit registration"}
      </Button>
    </form>
  );
}
