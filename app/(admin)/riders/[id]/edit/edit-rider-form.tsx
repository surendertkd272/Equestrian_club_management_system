"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

// Every value is a string on the form (Input gives us strings; numbers
// get coerced on the server). Empty string means "clear this field" for
// nullable columns; for required columns (firstName, lastName, dob,
// mobile) the form refuses to submit if they're empty.
type FormState = Record<string, string>;

// Keys that map to nullable DB columns — empty string is sent as
// explicit null, so a previously-set value gets cleared.
const NULLABLE_KEYS = new Set([
  "photoUrl", "placeOfBirth", "nationality", "gender", "maritalStatus",
  "aadhaarNo", "aadhaarDocUrl", "email", "preferredLanguage",
  "school", "education", "occupation",
  "addressPresent", "addressPermanent", "pincode",
  "fatherName", "fatherPhone", "motherName", "motherPhone",
  "emergencyName", "emergencyPhone",
  "heightCm", "weightKg",
  "medicalNotes", "allergies", "currentLevel",
  "stateRiderId", "efiRiderId",
]);

// Numeric coercion is server-side — keep these as strings so the input
// can hold partial values like "65." mid-typing.
const NUMERIC_KEYS = new Set(["heightCm", "weightKg"]);

export function EditRiderForm({ id, initial }: { id: string; initial: FormState }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);

  const dirtyKeys = useMemo(() => {
    return Object.keys(state).filter((k) => state[k] !== initial[k]);
  }, [state, initial]);
  const dirty = dirtyKeys.length > 0;
  useUnsavedChanges(dirty && !busy);

  function update<K extends string>(key: K, value: string) {
    setState((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    if (!dirty) return;
    // Cheap client-side guard for required columns. Server enforces too.
    if (!state.firstName.trim()) return toast.error("First name is required");
    if (!state.lastName.trim()) return toast.error("Last name is required");
    if (!state.dob) return toast.error("Date of birth is required");
    if (!state.mobile.trim()) return toast.error("Mobile is required");

    // Build payload — only changed keys. Nullable empty strings become null.
    const payload: Record<string, unknown> = {};
    for (const k of dirtyKeys) {
      const v = state[k];
      if (NUMERIC_KEYS.has(k)) {
        payload[k] = v.trim() === "" ? null : Number(v);
      } else if (NULLABLE_KEYS.has(k)) {
        payload[k] = v.trim() === "" ? null : v;
      } else {
        payload[k] = v;
      }
    }
    // joiningDate maps to a required (non-null) Date column — don't send an
    // empty string if the user cleared the picker; just leave it unchanged.
    if ("joiningDate" in payload && !String(payload.joiningDate).trim()) {
      delete payload.joiningDate;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/riders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "VALIDATION" && data.details?.fieldErrors) {
          const first = Object.entries(data.details.fieldErrors).find(([, v]) => Array.isArray(v) && v.length);
          if (first) {
            const [field, msgs] = first as [string, string[]];
            toast.error(`${field}: ${msgs[0]}`);
            return;
          }
        }
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success("Profile saved");
      router.push(`/riders/${id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <Section title="Personal">
        <Field label="First Name" required>
          <Input value={state.firstName} onChange={(e) => update("firstName", e.target.value)} />
        </Field>
        <Field label="Last Name" required>
          <Input value={state.lastName} onChange={(e) => update("lastName", e.target.value)} />
        </Field>
        <Field label="Date of Birth" required>
          <Input type="date" value={state.dob} onChange={(e) => update("dob", e.target.value)} />
        </Field>
        <Field label="Date of Joining">
          <Input type="date" value={state.joiningDate} onChange={(e) => update("joiningDate", e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">Set the real joining date for riders who were part of the club before this registration.</p>
        </Field>
        <Field label="Gender">
          <Select value={state.gender} onChange={(e) => update("gender", e.target.value)}>
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Place of Birth">
          <Input value={state.placeOfBirth} onChange={(e) => update("placeOfBirth", e.target.value)} />
        </Field>
        <Field label="Nationality">
          <Input value={state.nationality} onChange={(e) => update("nationality", e.target.value)} />
        </Field>
        <Field label="Marital Status">
          <Input value={state.maritalStatus} onChange={(e) => update("maritalStatus", e.target.value)} />
        </Field>
        <Field label="Photo URL">
          <Input
            value={state.photoUrl}
            onChange={(e) => update("photoUrl", e.target.value)}
            placeholder="/uploads/<file>"
          />
        </Field>
      </Section>

      <Section title="ID">
        <Field label="Aadhaar Number">
          <Input
            value={state.aadhaarNo}
            onChange={(e) => update("aadhaarNo", e.target.value.replace(/\D/g, ""))}
            placeholder="12 digits"
            maxLength={12}
          />
        </Field>
        <Field label="Aadhaar Document URL">
          <Input
            value={state.aadhaarDocUrl}
            onChange={(e) => update("aadhaarDocUrl", e.target.value)}
            placeholder="/uploads/<file>"
          />
        </Field>
        <Field label="State Rider ID">
          <Input value={state.stateRiderId} onChange={(e) => update("stateRiderId", e.target.value)} />
        </Field>
        <Field label="EFI Rider ID">
          <Input value={state.efiRiderId} onChange={(e) => update("efiRiderId", e.target.value)} />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Mobile" required>
          <Input value={state.mobile} onChange={(e) => update("mobile", e.target.value)} />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={state.email}
            onChange={(e) => update("email", e.target.value)}
          />
        </Field>
        <Field label="Preferred Language">
          <Select
            value={state.preferredLanguage}
            onChange={(e) => update("preferredLanguage", e.target.value)}
          >
            <option value="">—</option>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="ta">Tamil</option>
            <option value="te">Telugu</option>
            <option value="bn">Bengali</option>
            <option value="mr">Marathi</option>
            <option value="gu">Gujarati</option>
            <option value="kn">Kannada</option>
            <option value="ml">Malayalam</option>
            <option value="pa">Punjabi</option>
          </Select>
        </Field>
        <Field label="School">
          <Input value={state.school} onChange={(e) => update("school", e.target.value)} />
        </Field>
        <Field label="Education">
          <Input value={state.education} onChange={(e) => update("education", e.target.value)} />
        </Field>
        <Field label="Occupation">
          <Input value={state.occupation} onChange={(e) => update("occupation", e.target.value)} />
        </Field>
      </Section>

      <Section title="Address">
        <Field label="Present Address" full>
          <Input
            value={state.addressPresent}
            onChange={(e) => update("addressPresent", e.target.value)}
          />
        </Field>
        <Field label="Permanent Address" full>
          <Input
            value={state.addressPermanent}
            onChange={(e) => update("addressPermanent", e.target.value)}
          />
        </Field>
        <Field label="Pincode">
          <Input
            value={state.pincode}
            onChange={(e) => update("pincode", e.target.value.replace(/\D/g, ""))}
            maxLength={6}
            placeholder="6 digits"
          />
        </Field>
      </Section>

      <Section title="Parents & emergency contact">
        <Field label="Father's name">
          <Input value={state.fatherName} onChange={(e) => update("fatherName", e.target.value)} />
        </Field>
        <Field label="Father's phone">
          <Input value={state.fatherPhone} onChange={(e) => update("fatherPhone", e.target.value)} />
        </Field>
        <Field label="Mother's name">
          <Input value={state.motherName} onChange={(e) => update("motherName", e.target.value)} />
        </Field>
        <Field label="Mother's phone">
          <Input value={state.motherPhone} onChange={(e) => update("motherPhone", e.target.value)} />
        </Field>
        <Field label="Emergency Contact Name">
          <Input value={state.emergencyName} onChange={(e) => update("emergencyName", e.target.value)} />
        </Field>
        <Field label="Emergency Contact Phone">
          <Input value={state.emergencyPhone} onChange={(e) => update("emergencyPhone", e.target.value)} />
        </Field>
      </Section>

      <Section title="Anthropometrics & medical">
        <Field label="Height (cm)">
          <Input
            type="number"
            step="0.1"
            value={state.heightCm}
            onChange={(e) => update("heightCm", e.target.value)}
          />
        </Field>
        <Field label="Weight (kg)">
          <Input
            type="number"
            step="0.1"
            value={state.weightKg}
            onChange={(e) => update("weightKg", e.target.value)}
          />
        </Field>
        <Field label="Current Level">
          <Input value={state.currentLevel} onChange={(e) => update("currentLevel", e.target.value)} />
        </Field>
        <Field label="Allergies" full>
          <Textarea
            value={state.allergies}
            onChange={(e) => update("allergies", e.target.value)}
            rows={2}
          />
        </Field>
        <Field label="Medical Notes" full>
          <Textarea
            value={state.medicalNotes}
            onChange={(e) => update("medicalNotes", e.target.value)}
            rows={3}
          />
        </Field>
      </Section>

      <div className="flex items-center gap-3 border-t pt-4">
        <Button onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : dirty ? `Save (${dirtyKeys.length} change${dirtyKeys.length === 1 ? "" : "s"})` : "No changes"}
        </Button>
        <a
          href={`/riders/${id}`}
          className="rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          Cancel
        </a>
        {dirty && (
          <span className="text-xs text-muted-foreground">
            Height/weight changes auto-recompute BMI.
          </span>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
  full,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <Label className="mb-1 block text-xs">
        {label} {required && <span className="text-rose-500">*</span>}
      </Label>
      {children}
    </div>
  );
}
