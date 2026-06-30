"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  VENDOR_CATEGORIES,
  VENDOR_CATEGORY_LABEL,
  VET_QUALIFICATIONS,
  VET_SPECIALTIES,
  FARRIER_SPECIALISATIONS,
  WEEKDAYS,
} from "@/lib/schemas/vendor";
import { postJson } from "@/lib/client/post-json";

// Sprint 3.6: vendor form now renders category-specific extra fields
// for Vet Doctor + Farrier. The base fields (name / contact / phone /
// email / address / GSTIN / notes) are common across all categories.
// Extras get serialised to Vendor.categorySpecificJson by the API.

type VetExtras = {
  vciNumber: string;
  qualification: string;
  specialty: string;
  yearsPractice: string;
  emergencyAvailable: boolean;
  clinicAffiliation: string;
};

type FarrierExtras = {
  yearsExperience: string;
  specialisations: string[];
  availableDays: string[];
  carriesForge: boolean;
  hourlyRate: string;
};

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
    deliveryScope: "centre" as "centre" | "national",
    contactName: "",
    phone: "",
    email: "",
    address: "",
    gstin: "",
    bankAccountName: "",
    bankAccountNumber: "",
    bankIfsc: "",
    bankName: "",
    upiId: "",
    notes: "",
    centreId: pinnedCentreId ?? centres[0]?.id ?? "",
  });
  const [vet, setVet] = useState<VetExtras>({
    vciNumber: "",
    qualification: "",
    specialty: "",
    yearsPractice: "",
    emergencyAvailable: false,
    clinicAffiliation: "",
  });
  const [farrier, setFarrier] = useState<FarrierExtras>({
    yearsExperience: "",
    specialisations: [],
    availableDays: [],
    carriesForge: false,
    hourlyRate: "",
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleArray<T extends string>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  function buildCategorySpecific(): Record<string, unknown> | undefined {
    if (form.category === "vet") {
      // Drop empty values so the JSON blob stays small. Use the
      // explicit-undefined trick: presence in the object = was filled.
      const obj: Record<string, unknown> = {};
      if (vet.vciNumber.trim()) obj.vciNumber = vet.vciNumber.trim();
      if (vet.qualification) obj.qualification = vet.qualification;
      if (vet.specialty) obj.specialty = vet.specialty;
      if (vet.yearsPractice) obj.yearsPractice = Number(vet.yearsPractice);
      if (vet.emergencyAvailable) obj.emergencyAvailable = true;
      if (vet.clinicAffiliation.trim()) obj.clinicAffiliation = vet.clinicAffiliation.trim();
      return Object.keys(obj).length ? obj : undefined;
    }
    if (form.category === "farrier") {
      const obj: Record<string, unknown> = {};
      if (farrier.yearsExperience) obj.yearsExperience = Number(farrier.yearsExperience);
      if (farrier.specialisations.length) obj.specialisations = farrier.specialisations;
      if (farrier.availableDays.length) obj.availableDays = farrier.availableDays;
      if (farrier.carriesForge) obj.carriesForge = true;
      if (farrier.hourlyRate) obj.hourlyRate = Number(farrier.hourlyRate);
      return Object.keys(obj).length ? obj : undefined;
    }
    return undefined;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.centreId) {
      toast.error("Pick a centre.");
      return;
    }
    if (form.category === "vet" && !vet.vciNumber.trim()) {
      toast.error("VCI / state council registration number is required for vets.");
      return;
    }
    if (form.category === "vet" && !vet.qualification) {
      toast.error("Pick a qualification for the vet.");
      return;
    }
    if (form.category === "farrier" && !farrier.yearsExperience) {
      toast.error("Years of experience is required for farriers.");
      return;
    }
    setBusy(true);
    const res = await postJson("/api/vendors", {
      ...form,
      email: form.email || undefined,
      categorySpecific: buildCategorySpecific(),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Vendor added");
    setForm((f) => ({
      ...f,
      name: "", contactName: "", phone: "", email: "", address: "", gstin: "",
      bankAccountName: "", bankAccountNumber: "", bankIfsc: "", bankName: "", upiId: "",
      notes: "",
    }));
    setVet({ vciNumber: "", qualification: "", specialty: "", yearsPractice: "", emergencyAvailable: false, clinicAffiliation: "" });
    setFarrier({ yearsExperience: "", specialisations: [], availableDays: [], carriesForge: false, hourlyRate: "" });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Name *</Label>
        <Input aria-label="Name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Category *</Label>
        <Select aria-label="Category" value={form.category} onChange={(e) => set("category", e.target.value as typeof form.category)}>
          {VENDOR_CATEGORIES.map((c) => (
            <option key={c} value={c}>{VENDOR_CATEGORY_LABEL[c]}</option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label>Delivery coverage *</Label>
        <Select aria-label="Delivery coverage" value={form.deliveryScope} onChange={(e) => set("deliveryScope", e.target.value as "centre" | "national")}>
          <option value="centre">Centre-specific — only this club uses it</option>
          <option value="national">All-India — delivers to every club</option>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          All-India vendors appear in every club's vendor list and expense picker; centre-specific ones stay local.
        </p>
      </div>
      {!pinnedCentreId && centres.length > 1 && (
        <div className="space-y-1.5 md:col-span-2">
          <Label>Centre *</Label>
          <Select aria-label="Centre" value={form.centreId} onChange={(e) => set("centreId", e.target.value)}>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Contact person</Label>
        <Input aria-label="Contact person" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Phone</Label>
        <Input aria-label="Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit" />
      </div>
      <div className="space-y-1.5">
        <Label>Email</Label>
        <Input aria-label="Email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>GSTIN</Label>
        <Input aria-label="GSTIN" value={form.gstin} onChange={(e) => set("gstin", e.target.value)} />
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label>Address</Label>
        <Input aria-label="Address" value={form.address} onChange={(e) => set("address", e.target.value)} />
      </div>

      {/* Bank details — optional, all four collapsed to one row to keep
          the common case (no bank info) visually quiet. */}
      <fieldset className="md:col-span-2 rounded-md border bg-muted/30 p-3 space-y-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Bank details (optional — for NEFT / IMPS payouts)
        </legend>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Account holder name</Label>
            <Input aria-label="Account holder name" value={form.bankAccountName} onChange={(e) => set("bankAccountName", e.target.value)} placeholder="As on bank record" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Bank name</Label>
            <Input aria-label="Bank name" value={form.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="SBI / HDFC / ICICI / …" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Account number</Label>
            <Input aria-label="Account number" value={form.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value)} placeholder="123456789012" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">IFSC code</Label>
            <Input aria-label="IFSC code"
              value={form.bankIfsc}
              onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())}
              placeholder="HDFC0000123"
              maxLength={11}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">UPI ID</Label>
            <Input aria-label="UPI ID"
              value={form.upiId}
              onChange={(e) => set("upiId", e.target.value)}
              placeholder="vendor@okhdfcbank"
              maxLength={60}
            />
          </div>
        </div>
      </fieldset>

      {/* Per-category extra fields */}
      {form.category === "vet" && (
        <fieldset className="md:col-span-2 rounded-md border bg-muted/30 p-3 space-y-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Vet doctor registration
          </legend>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>VCI / Council reg # *</Label>
              <Input aria-label="VCI / Council reg #"
                value={vet.vciNumber}
                onChange={(e) => setVet({ ...vet, vciNumber: e.target.value })}
                placeholder="State veterinary council registration"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Qualification *</Label>
              <Select aria-label="Qualification" value={vet.qualification} onChange={(e) => setVet({ ...vet, qualification: e.target.value })}>
                <option value="">— pick —</option>
                {VET_QUALIFICATIONS.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Specialty</Label>
              <Select aria-label="Specialty" value={vet.specialty} onChange={(e) => setVet({ ...vet, specialty: e.target.value })}>
                <option value="">— (none) —</option>
                {VET_SPECIALTIES.map((s) => (
                  <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Years of practice</Label>
              <Input aria-label="Years of practice"
                type="number"
                min={0}
                max={80}
                value={vet.yearsPractice}
                onChange={(e) => setVet({ ...vet, yearsPractice: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={vet.emergencyAvailable}
                  onChange={(e) => setVet({ ...vet, emergencyAvailable: e.target.checked })}
                />
                Available 24×7 for emergencies
              </label>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Clinic / hospital affiliation</Label>
              <Input aria-label="Clinic / hospital affiliation"
                value={vet.clinicAffiliation}
                onChange={(e) => setVet({ ...vet, clinicAffiliation: e.target.value })}
                placeholder="e.g. Equine Veterinary Hospital, Hauz Khas"
              />
            </div>
          </div>
        </fieldset>
      )}

      {form.category === "farrier" && (
        <fieldset className="md:col-span-2 rounded-md border bg-muted/30 p-3 space-y-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Farrier registration
          </legend>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Years of experience *</Label>
              <Input aria-label="Years of experience"
                type="number"
                min={0}
                max={80}
                value={farrier.yearsExperience}
                onChange={(e) => setFarrier({ ...farrier, yearsExperience: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hourly / per-horse rate (₹)</Label>
              <Input aria-label="Hourly / per-horse rate (₹)"
                type="number"
                min={0}
                value={farrier.hourlyRate}
                onChange={(e) => setFarrier({ ...farrier, hourlyRate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Specialisations</Label>
              <div className="flex flex-wrap gap-2">
                {FARRIER_SPECIALISATIONS.map((s) => (
                  <label key={s} className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={farrier.specialisations.includes(s)}
                      onChange={() => setFarrier({ ...farrier, specialisations: toggleArray(farrier.specialisations, s) })}
                    />
                    {s.replaceAll("_", " ")}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Available days</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => (
                  <label key={d} className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={farrier.availableDays.includes(d)}
                      onChange={() => setFarrier({ ...farrier, availableDays: toggleArray(farrier.availableDays, d) })}
                    />
                    {d}
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={farrier.carriesForge}
                  onChange={(e) => setFarrier({ ...farrier, carriesForge: e.target.checked })}
                />
                Carries own forge / anvil (needed for hot shoeing)
              </label>
            </div>
          </div>
        </fieldset>
      )}

      <div className="space-y-1.5 md:col-span-2">
        <Label>Notes</Label>
        <Input aria-label="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="On-call hours, preferred contact, etc." />
      </div>
      <Button type="submit" disabled={busy} className="md:col-span-2 w-full">
        {busy ? "Adding…" : "Add vendor"}
      </Button>
    </form>
  );
}
