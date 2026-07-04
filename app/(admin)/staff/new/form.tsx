"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { compressForKind } from "@/lib/image-compress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ASSIGNABLE_STAFF_ROLES } from "@/lib/schemas/staff";

type UploadField = "aadhaarUrl" | "policeVerificationUrl";

const UPLOAD_KIND: Record<UploadField, string> = {
  aadhaarUrl: "staff_aadhaar",
  policeVerificationUrl: "staff_police_verification",
};

export function NewStaffForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<UploadField | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "COACH",
    salaryBand: "",
    joiningDate: "",
    password: "password123",
    aadhaarUrl: "",
    policeVerificationUrl: "",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onUpload(field: UploadField, file: File) {
    setUploading(field);
    try {
      const compressed = await compressForKind(file, UPLOAD_KIND[field]);
      const fd = new FormData();
      fd.append("kind", UPLOAD_KIND[field]);
      fd.append("file", compressed);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message ?? err.error ?? "Upload failed");
        return;
      }
      const data = await res.json();
      set(field, data.url as string);
      toast.success("File uploaded");
    } finally {
      setUploading(null);
    }
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
      // Prefer the server's human-readable `message`; fall back to known codes.
      toast.error(
        err.message ?? (err.error === "EMAIL_IN_USE" ? "Email already in use" : err.error ?? "Failed"),
      );
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
          <Input aria-label="Name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Email *</Label>
          <Input aria-label="Email" required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input aria-label="Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit" />
        </div>
        <div className="space-y-1.5">
          <Label>Role *</Label>
          <Select aria-label="Role" value={form.role} onChange={(e) => set("role", e.target.value)}>
            {ASSIGNABLE_STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Salary Band</Label>
          <Input aria-label="Salary band" value={form.salaryBand} onChange={(e) => set("salaryBand", e.target.value)} placeholder="e.g. L3" />
        </div>
        <div className="space-y-1.5">
          <Label>Date of Joining</Label>
          <Input aria-label="Date of joining" type="date" value={form.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} />
          <p className="text-xs text-muted-foreground">Set the real joining date for staff who were part of the club before this registration. Leave blank to use today.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Initial Password</Label>
          <Input aria-label="Initial password" value={form.password} onChange={(e) => set("password", e.target.value)} />
        </div>
      </div>

      <div className="rounded-md border border-dashed p-4 space-y-3">
        <div className="text-sm font-semibold">KYC documents <span className="text-xs font-normal text-muted-foreground">(optional — can be added later)</span></div>
        <div className="grid gap-4 md:grid-cols-2">
          <UploadRow
            label="Aadhaar Card"
            field="aadhaarUrl"
            url={form.aadhaarUrl}
            busy={uploading === "aadhaarUrl"}
            onPick={(f) => onUpload("aadhaarUrl", f)}
            onClear={() => set("aadhaarUrl", "")}
          />
          <UploadRow
            label="Police Verification Certificate"
            field="policeVerificationUrl"
            url={form.policeVerificationUrl}
            busy={uploading === "policeVerificationUrl"}
            onPick={(f) => onUpload("policeVerificationUrl", f)}
            onClear={() => set("policeVerificationUrl", "")}
          />
        </div>
      </div>

      <Button type="submit" disabled={saving || uploading !== null} className="w-full">
        {saving ? "Creating…" : "Create staff"}
      </Button>
    </form>
  );
}

function UploadRow({
  label,
  field,
  url,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  field: string;
  url: string;
  busy: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {url ? (
        <div className="flex items-center gap-2 text-sm">
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline truncate">
            View uploaded file
          </a>
          <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">
            Remove
          </button>
        </div>
      ) : (
        <Input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            // Reset input so re-picking the same file still fires onChange.
            e.target.value = "";
          }}
        />
      )}
      {busy && <div className="text-xs text-muted-foreground">Uploading…</div>}
    </div>
  );
}
