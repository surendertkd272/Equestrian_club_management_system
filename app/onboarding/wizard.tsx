"use client";

// Per-step useForm refactor. Before this rewrite, one `useForm<OnboardingInput>`
// instance fed all six steps via FormProvider/useFormContext. That worked but
// forced ~19 `as any` casts because rhf's typed APIs (register, watch,
// setValue, formState.errors) want a Path<T> narrower than the union of step
// keys, and OnboardingInput's many required fields fought partial defaults.
//
// Now: each step owns its own useForm<StepInput> bound to that step's Zod
// schema. The parent wizard tracks accumulated data and re-seeds each step
// from it via defaultValues, so going Back doesn't lose what was typed.
// Generic Field<T> / Textarea<T> / UploadField<T> components stay DRY but
// take the step's UseFormReturn<T> instead of pulling from FormProvider
// context — no more cast-through-keyof tricks.
//
// Submission stays a single POST to /api/onboarding at the end of the
// indemnity step (with the assembled object). Razorpay flow is unchanged.

import { useState, useEffect } from "react";
import { useForm, type UseFormReturn, type FieldValues, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CaptchaField, EMPTY_CAPTCHA, type CaptchaValue } from "@/components/captcha-field";
import { z } from "zod";
import { compressForKind } from "@/lib/image-compress";
import {
  personalSchema,
  addressSchema,
  parentsSchema,
  medicalSchema,
  indemnitySchema,
  parentalConsentRequiredSchema,
  ageYears,
  PARENTAL_CONSENT_TEXT,
  type OnboardingInput,
} from "@/lib/schemas/rider-onboarding";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { bmiBand, bmiBandLabel, bmiBandTone } from "@/lib/bmi";
import { calcBmi } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Per-step input types — inferred from the Zod schemas, no manual sync needed.

type PersonalInput = z.infer<typeof personalSchema>;
type AddressInput = z.infer<typeof addressSchema>;
type ParentsInput = z.infer<typeof parentsSchema>;
type MedicalInput = z.infer<typeof medicalSchema>;
type IndemnityInput = z.infer<typeof indemnitySchema>;
type ParentalConsentInput = z.infer<typeof parentalConsentRequiredSchema>;

// Accumulated data across steps. Carries the union of every step's keys plus
// centreSlug (added by the parent). Used as the source for re-seeding a step's
// defaultValues when the user goes Back-and-forward.
type WizardData = Partial<OnboardingInput>;

// Pick only the keys a step's schema declares — used to seed a step's
// defaultValues from accumulated WizardData. Keeps each step ignorant of
// fields owned by other steps.
function pickValues<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  source: WizardData,
): Partial<z.infer<S>> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(schema.shape)) {
    const v = (source as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<z.infer<S>>;
}

// Step ordering is computed at render time from the user's DOB. Under-18
// riders get an extra "Parental Consent" step between Medical and Indemnity
// — DPDPA Section 9 makes verifiable consent from a parent/guardian a
// hard requirement, and /api/onboarding rejects the submission otherwise.
//
// The final step is a 'submitted' confirmation card — the API doesn't bill
// at submit time (status goes to pending_approval; the invoice + payment
// link arrive by email when an admin approves). An earlier version tried
// to render an immediate Razorpay step here against fields the API doesn't
// return, which is what surfaced as the 'Application error: a client-side
// exception' bug.
type StepKey = "personal" | "address" | "parents" | "medical" | "parental-consent" | "indemnity" | "submitted";
const STEP_TITLES: Record<StepKey, string> = {
  personal: "Personal",
  address: "Address",
  parents: "Parents & Emergency",
  medical: "Medical",
  "parental-consent": "Parental Consent",
  indemnity: "Indemnity E-Sign",
  submitted: "Submitted",
};

function buildSteps(dob: string | undefined): StepKey[] {
  // Compute minor status from the DOB the user entered in PersonalStep.
  // If DOB isn't filled yet (first render) we don't know — default to
  // showing the parental step so navigating Back from later steps doesn't
  // suddenly add a panel and re-shuffle the index. If they're definitely
  // an adult, drop the step.
  const adult = dob ? ageYears(new Date(dob)) >= 18 : false;
  if (adult) return ["personal", "address", "parents", "medical", "indemnity", "submitted"];
  return ["personal", "address", "parents", "medical", "parental-consent", "indemnity", "submitted"];
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable per-step UI bits. Each one is generic over T (the step's input
// shape) so the call site keeps its rhf typing — no `keyof OnboardingInput`
// or `name as any` tricks.

function Field<T extends FieldValues>({
  methods,
  name,
  label,
  type = "text",
  placeholder,
  required,
  inputMode,
}: {
  methods: UseFormReturn<T>;
  name: FieldPath<T>;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const { register, formState } = methods;
  // rhf nests errors by path; for top-level keys (which is all we have) the
  // direct read is safe. Cast through unknown because FieldErrors's value
  // type is recursive and TS can't infer the leaf shape here.
  const err = (formState.errors[name] as { message?: string } | undefined)?.message;
  // FormField wires the label↔input id + aria-invalid/aria-describedby/role=alert
  // for the inline error, so a screen reader announces the validation message.
  return (
    <FormField label={label} error={err} required={required}>
      {(p) => <Input type={type} inputMode={inputMode} placeholder={placeholder} {...p} {...register(name)} />}
    </FormField>
  );
}

function TextareaField<T extends FieldValues>({
  methods,
  name,
  label,
  placeholder,
  required,
}: {
  methods: UseFormReturn<T>;
  name: FieldPath<T>;
  label: string;
  placeholder?: string;
  required?: boolean;
}) {
  const { register, formState } = methods;
  const err = (formState.errors[name] as { message?: string } | undefined)?.message;
  // Routed through FormField like every other input, so the error is announced
  // (role=alert), linked to the control (aria-describedby) and the control is
  // marked invalid — this one rendered a bare <p> and did none of that.
  return (
    <FormField label={label} error={err} required={required}>
      {(p) => <Textarea placeholder={placeholder} {...p} {...register(name)} />}
    </FormField>
  );
}

function UploadField<T extends FieldValues>({
  methods,
  name,
  label,
  kind,
  accept,
  hint,
}: {
  methods: UseFormReturn<T>;
  name: FieldPath<T>;
  label: string;
  kind: "rider_photo" | "rider_aadhaar";
  accept: string;
  hint?: string;
}) {
  const { register, setValue, watch } = methods;
  // watch() returns the form's value for `name`. The URL is a string when set;
  // explicit narrow keeps the consumer free of unknown.
  const raw = watch(name);
  const value = typeof raw === "string" ? raw : undefined;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    const compressed = await compressForKind(file, kind);
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", compressed);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.message ?? data.error ?? "Upload failed");
        setBusy(false);
        return;
      }
      // setValue's third arg accepts shouldDirty etc. The value cast is
      // local: setValue's signature wants PathValue<T, typeof name> which
      // TS can't tighten further from the generic vantage point here.
      setValue(name, data.url as never, { shouldDirty: true });
      setBusy(false);
    } catch {
      setErr("Network error");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {/* Hidden field so the URL travels with the form's submit payload. */}
      <input type="hidden" {...register(name)} />
      <input
        type="file"
        accept={accept}
        onChange={onChange}
        disabled={busy}
        className="block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-muted disabled:opacity-50"
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      {busy && <p className="text-[10px] text-muted-foreground">Uploading…</p>}
      {value && !busy && (
        <p className="text-[11px] text-success-foreground">
          ✓ Uploaded — <a href={value} target="_blank" rel="noreferrer" className="underline">preview</a>
        </p>
      )}
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  );
}

function StepFooter({
  onBack,
  canBack,
  submitting,
  submitLabel,
  blocked,
}: {
  onBack?: () => void;
  canBack: boolean;
  submitting: boolean;
  submitLabel: string;
  /** Why the submit is unavailable, shown as a title so it isn't a dead button. */
  blocked?: string | null;
}) {
  return (
    <div className="flex items-center justify-between border-t pt-4">
      <Button type="button" variant="outline" onClick={onBack} disabled={!canBack || submitting}>
        <ChevronLeft className="h-4 w-4" /> Back
      </Button>
      <Button type="submit" disabled={submitting || Boolean(blocked)} title={blocked ?? undefined}>
        {submitting ? "Working…" : submitLabel} <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step components. Each owns its own useForm and submits its slice to the
// parent. The parent merges + advances.

function PersonalStep({ initial, onNext }: { initial: WizardData; onNext: (d: PersonalInput) => void }) {
  const methods = useForm<PersonalInput>({
    resolver: zodResolver(personalSchema),
    mode: "onTouched",
    defaultValues: { gender: "male", ...pickValues(personalSchema, initial) },
  });
  return (
    <form onSubmit={methods.handleSubmit(onNext)} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field methods={methods} name="firstName" label="First Name" required />
        <Field methods={methods} name="lastName" label="Last Name" required />
        <Field methods={methods} name="dob" label="Date of Birth" type="date" required />
        <div className="space-y-1.5">
          <Label>Gender *</Label>
          <Select aria-label="Gender" {...methods.register("gender")}>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <Field methods={methods} name="mobile" label="Mobile" required placeholder="10-digit" inputMode="tel" />
        <Field methods={methods} name="email" label="Email" type="email" />
        <Field methods={methods} name="aadhaarNo" label="Aadhaar (12 Digits)" placeholder="123412341234" inputMode="numeric" />
        <Field methods={methods} name="placeOfBirth" label="Place of Birth" />
        <Field methods={methods} name="nationality" label="Nationality" placeholder="Indian" />
        <Field methods={methods} name="maritalStatus" label="Marital Status" />
        <Field methods={methods} name="school" label="School" placeholder="School / college name" />
        <Field methods={methods} name="schoolClass" label="Class" placeholder="e.g. 7, VII, Grade 7" />
        <Field methods={methods} name="schoolSection" label="Section" placeholder="e.g. A" />
        <Field methods={methods} name="education" label="Education" />
        <Field methods={methods} name="occupation" label="Occupation" />

        <div className="md:col-span-2 grid gap-3 md:grid-cols-2 rounded-md border bg-muted/30 p-3">
          <UploadField
            methods={methods}
            name="photoUrl"
            label="Photo"
            kind="rider_photo"
            accept="image/jpeg,image/png,image/webp"
            hint="JPG / PNG / WebP, up to 5 MB"
          />
          <UploadField
            methods={methods}
            name="aadhaarDocUrl"
            label="Aadhaar — Front"
            kind="rider_aadhaar"
            accept="image/jpeg,image/png,application/pdf"
            hint="JPG / PNG / PDF, up to 5 MB. Stored privately on our managed cloud."
          />
          <UploadField
            methods={methods}
            name="aadhaarBackDocUrl"
            label="Aadhaar — Back"
            kind="rider_aadhaar"
            accept="image/jpeg,image/png,application/pdf"
            hint="JPG / PNG / PDF, up to 5 MB."
          />
        </div>
      </div>
      <StepFooter canBack={false} submitting={false} submitLabel="Next" />
    </form>
  );
}

function AddressStep({
  initial,
  onNext,
  onBack,
}: {
  initial: WizardData;
  onNext: (d: AddressInput) => void;
  onBack: () => void;
}) {
  const methods = useForm<AddressInput>({
    resolver: zodResolver(addressSchema),
    mode: "onTouched",
    defaultValues: pickValues(addressSchema, initial),
  });
  return (
    <form onSubmit={methods.handleSubmit(onNext)} className="space-y-6">
      <div className="grid gap-4">
        <TextareaField methods={methods} name="addressPresent" label="Present Address" required />
        <TextareaField
          methods={methods}
          name="addressPermanent"
          label="Permanent Address (leave blank if same)"
        />
        <div className="max-w-xs">
          <Field methods={methods} name="pincode" label="Pincode" required placeholder="201001" inputMode="numeric" />
        </div>
      </div>
      <StepFooter canBack onBack={onBack} submitting={false} submitLabel="Next" />
    </form>
  );
}

function ParentsStep({
  initial,
  onNext,
  onBack,
}: {
  initial: WizardData;
  onNext: (d: ParentsInput) => void;
  onBack: () => void;
}) {
  const methods = useForm<ParentsInput>({
    resolver: zodResolver(parentsSchema),
    mode: "onTouched",
    defaultValues: pickValues(parentsSchema, initial),
  });
  return (
    <form onSubmit={methods.handleSubmit(onNext)} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field methods={methods} name="fatherName" label="Father's Name" />
        <Field methods={methods} name="fatherPhone" label="Father's Phone" inputMode="tel" />
        <Field methods={methods} name="motherName" label="Mother's Name" />
        <Field methods={methods} name="motherPhone" label="Mother's Phone" inputMode="tel" />
        <Field methods={methods} name="emergencyName" label="Emergency Contact Name" required />
        <Field methods={methods} name="emergencyPhone" label="Emergency Contact Phone" required inputMode="tel" />
      </div>
      <StepFooter canBack onBack={onBack} submitting={false} submitLabel="Next" />
    </form>
  );
}

function MedicalStep({
  initial,
  onNext,
  onBack,
}: {
  initial: WizardData;
  onNext: (d: MedicalInput) => void;
  onBack: () => void;
}) {
  const methods = useForm<MedicalInput>({
    resolver: zodResolver(medicalSchema),
    mode: "onTouched",
    defaultValues: pickValues(medicalSchema, initial),
  });
  // BMI is derived from the live form values, not a stored field.
  const h = methods.watch("heightCm");
  const w = methods.watch("weightKg");
  const bmi = calcBmi(Number(h) || null, Number(w) || null);
  return (
    <form onSubmit={methods.handleSubmit(onNext)} className="space-y-6">
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Field methods={methods} name="heightCm" label="Height (cm)" type="number" />
          <Field methods={methods} name="weightKg" label="Weight (kg)" type="number" />
          <div className="space-y-1.5">
            <Label>BMI (Auto)</Label>
            <div className="flex h-10 items-center gap-2 rounded-md border bg-muted px-3 text-sm">
              <span>{bmi ?? "—"}</span>
              {/* A bare number means nothing to a parent filling this in on a
                  phone. The band is the part that is actually readable, and it
                  is the same wording the club sees on the rider profile. */}
              {bmi != null && (
                <Badge variant={bmiBandTone(bmiBand(bmi))}>{bmiBandLabel(bmiBand(bmi))}</Badge>
              )}
            </div>
          </div>
        </div>
        <TextareaField
          methods={methods}
          name="medicalNotes"
          label="Medical Conditions"
          placeholder="Asthma, prior fractures, etc."
        />
        <TextareaField
          methods={methods}
          name="allergies"
          label="Allergies"
          placeholder="Drugs, food, dust, hay…"
        />
      </div>
      <StepFooter canBack onBack={onBack} submitting={false} submitLabel="Next" />
    </form>
  );
}

// Only rendered when the rider is under 18 (DPDPA Section 9). Collects the
// parent/guardian's name + relation + phone + email and a versioned
// consent checkbox. The pinned PARENTAL_CONSENT_TEXT is what the parent
// agrees to; if that text ever revs, PARENTAL_CONSENT_VERSION bumps and
// records signed against v1 stay verifiable.
function ParentalConsentStep({
  initial,
  onNext,
  onBack,
}: {
  initial: WizardData;
  onNext: (d: ParentalConsentInput) => void;
  onBack: () => void;
}) {
  const methods = useForm<ParentalConsentInput>({
    resolver: zodResolver(parentalConsentRequiredSchema),
    mode: "onTouched",
    defaultValues: pickValues(parentalConsentRequiredSchema, initial),
  });
  const consentError = methods.formState.errors.parentConsentAgreed?.message;
  const relationError = methods.formState.errors.parentRelation?.message;
  return (
    <form onSubmit={methods.handleSubmit(onNext)} className="space-y-6">
      <div className="space-y-4">
        <div className="rounded-md border-2 border-warning/30 bg-warning-soft p-3 text-xs text-warning-foreground">
          The rider is under 18. DPDPA Section 9 requires a parent or legal guardian to
          provide consent before we can process the rider's personal data. Fill the
          fields below — the parent's name + agreement is the legal signature.
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field methods={methods} name="parentName" label="Parent / Guardian Full Name" required />
          <div className="space-y-1.5">
            <Label htmlFor="parentRelation">Relation *</Label>
            <Select id="parentRelation" aria-invalid={!!relationError} aria-describedby={relationError ? "parentRelation-err" : undefined} {...methods.register("parentRelation")}>
              <option value="">— select —</option>
              <option value="father">Father</option>
              <option value="mother">Mother</option>
              <option value="guardian">Legal Guardian</option>
            </Select>
            {relationError && <p id="parentRelation-err" role="alert" className="text-xs text-destructive">{relationError}</p>}
          </div>
          <Field methods={methods} name="parentPhone" label="Parent's Phone" required placeholder="10-digit mobile" inputMode="tel" />
          <Field methods={methods} name="parentEmail" label="Parent's Email" type="email" />
        </div>

        <div className="max-h-56 overflow-y-auto rounded-md border bg-muted p-4 text-sm leading-relaxed">
          <p className="font-semibold">Parental / Guardian Consent (DPDPA §9)</p>
          <p className="mt-2 whitespace-pre-line">{PARENTAL_CONSENT_TEXT}</p>
        </div>

        <label className="flex items-start gap-2 text-sm font-medium">
          <input type="checkbox" className="mt-1" aria-invalid={!!consentError} aria-describedby={consentError ? "parentConsentAgreed-err" : undefined} {...methods.register("parentConsentAgreed")} />
          <span>
            I am the parent / legal guardian named above and I agree to the consent text.
            My agreement is recorded with timestamp + IP as digital proof under DPDPA Section 9.
          </span>
        </label>
        {consentError && <p id="parentConsentAgreed-err" role="alert" className="text-xs text-destructive">{consentError}</p>}
      </div>
      <StepFooter canBack onBack={onBack} submitting={false} submitLabel="Next" />
    </form>
  );
}

function IndemnityStep({
  initial,
  onSubmit,
  onBack,
  submitting,
  captcha,
  onCaptchaChange,
  captchaKey,
  captchaError,
}: {
  initial: WizardData;
  onSubmit: (d: IndemnityInput) => void | Promise<void>;
  onBack: () => void;
  submitting: boolean;
  captcha: CaptchaValue;
  onCaptchaChange: (v: CaptchaValue) => void;
  captchaKey: number;
  captchaError: string | null;
}) {
  const methods = useForm<IndemnityInput>({
    resolver: zodResolver(indemnitySchema),
    mode: "onTouched",
    defaultValues: pickValues(indemnitySchema, initial),
  });
  const fullNameError = methods.formState.errors.fullNameSignature?.message;
  const agreedError = methods.formState.errors.agreed?.message;
  const nocError = methods.formState.errors.injuryNocAgreed?.message;
  return (
    <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <div className="max-h-64 overflow-y-auto rounded-md border bg-muted p-4 text-sm leading-relaxed">
          <p className="font-semibold">Horse Riding Indemnity & Liability Release</p>
          <p className="mt-2">
            I acknowledge that horse riding is an inherently risky activity involving large unpredictable animals.
            I voluntarily assume all risks of injury, including but not limited to falls, kicks, bites, and equipment
            failure. I release Equiwings, its centres, employees, contractors, and agents from any and all claims
            arising out of my participation.
          </p>
          <p className="mt-2">
            I confirm that the medical and contact information provided is accurate, and I authorise emergency medical
            treatment if required.
          </p>
          <p className="mt-2">
            I understand that registration & membership fees are non-refundable, and that 15 days of un-notified
            absence may result in cancellation of membership.
          </p>
        </div>

        {/* NOC for injuries — separate from the general indemnity block above
            so the consent record is unambiguous: both boxes must be ticked.
            Highlighted styling so a quick scrolling reader can't miss it. */}
        <div className="rounded-md border-2 border-warning/30 bg-warning-soft p-4 text-sm leading-relaxed">
          <p className="font-semibold text-warning-foreground">NOC for Injuries</p>
          <p className="mt-2 text-warning-foreground">
            I (the rider, or parent/guardian for minors) give my No-Objection Consent for the rider to participate
            in horse-riding activity at this centre. I acknowledge that riding involves a real risk of injury —
            falls, kicks, bites, equipment failure, and unpredictable horse behaviour can occur even under qualified
            supervision. I will not hold Equiwings, the centre, its coaches, grooms, or contractors liable for
            injuries sustained in the normal course of training, competition, or stable work. Centre staff will
            still administer reasonable first aid and authorise emergency medical care if needed.
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm font-medium text-warning-foreground">
            <input type="checkbox" className="mt-1" aria-invalid={!!nocError} aria-describedby={nocError ? "injuryNocAgreed-err" : undefined} {...methods.register("injuryNocAgreed")} />
            <span>I agree to the NOC for injuries (digital consent).</span>
          </label>
          {nocError && <p id="injuryNocAgreed-err" role="alert" className="mt-1 text-xs text-destructive">{nocError}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fullNameSignature">Type your full name to sign *</Label>
          <Input id="fullNameSignature" aria-invalid={!!fullNameError} aria-describedby={fullNameError ? "fullNameSignature-err" : undefined} placeholder="Full legal name" {...methods.register("fullNameSignature")} />
          {fullNameError && <p id="fullNameSignature-err" role="alert" className="text-xs text-destructive">{fullNameError}</p>}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" aria-invalid={!!agreedError} aria-describedby={agreedError ? "agreed-err" : undefined} {...methods.register("agreed")} />
          <span>
            I have read and agree to the indemnity above. I understand my electronic signature will be recorded with
            timestamp and IP address as legal proof of consent.
          </span>
        </label>
        {agreedError && <p id="agreed-err" role="alert" className="text-xs text-destructive">{agreedError}</p>}

        <CaptchaField
          value={captcha}
          onChange={onCaptchaChange}
          disabled={submitting}
          refreshKey={captchaKey}
          error={captchaError}
        />
      </div>
      {/* The verification box is the last thing on the longest step and is easy
          to scroll past. Disabling the button until it is answered turns a
          server rejection — which wipes the answer and reloads the question —
          into something the parent can see and fix before they submit. */}
      <StepFooter
        canBack
        onBack={onBack}
        submitting={submitting}
        submitLabel="Submit Application"
        blocked={
          !captcha.captchaToken
            ? "Waiting for the verification question to load"
            : !captcha.captchaAnswer.trim()
              ? "Answer the quick check above to submit"
              : null
        }
      />
    </form>
  );
}

// Success state after submitAll. The public-onboarding API doesn't bill on
// submit — it sets status="pending_approval" and lets a centre manager /
// school admin review before the registration invoice is created. So this
// step is a confirmation card, not a Razorpay surface.
//
// (An earlier version of the wizard expected an invoiceId + amount in the
// response and tried to render ₹{amount}.toLocaleString — when the API
// shape moved to pending-approval, the missing field crashed with the
// generic 'Application error: a client-side exception'. That's why this
// component now reads only riderId from the result.)
function SubmittedStep({
  result,
  centreName,
}: {
  result: { riderId: string; status: string; feesOn?: boolean } | null;
  centreName: string;
}) {
  if (!result) {
    return (
      <div className="rounded-md border bg-muted p-4 text-sm text-muted-foreground">
        Click <b>Submit Application</b> on the previous step to send your details.
      </div>
    );
  }
  // The centre's fee-collection switch determines what happens after approval:
  // fees ON → confirmation email + pay link to parent, then activation.
  // fees OFF → confirmation email only, immediate activation, no payment step.
  // Default to ON when the field is missing (older API clients) so we don't
  // accidentally over-promise no-fees to a paying centre.
  const feesOn = result.feesOn !== false;
  return (
    <div className="space-y-4 text-center">
      <div className="rounded-md border-2 border-success/30 bg-success-soft p-6">
        <div className="text-3xl">✓</div>
        <h2 className="mt-2 text-lg font-bold text-success-foreground">Application Received</h2>
        <p className="mt-2 text-sm text-success-foreground">
          Thank you. Your registration with <b>{centreName}</b> is now with the
          centre team for review.
        </p>
      </div>
      <div className="rounded-md border bg-card p-4 text-left text-sm">
        <div className="font-semibold">What happens next?</div>
        <ol className="ml-4 mt-2 list-decimal space-y-1 text-muted-foreground">
          <li>The centre's admin reviews your details (usually within 1–2 business days).</li>
          {feesOn ? (
            <>
              <li>Once approved, you'll receive a confirmation email. Any payment instructions go to your parent's contact on file.</li>
              <li>Once payment is settled, the rider is added to the active roster.</li>
            </>
          ) : (
            <li>Once approved, you'll receive a confirmation email and the rider is added to the active roster — no payment step at this centre.</li>
          )}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Reference: <code>{result.riderId.slice(-8)}</code> · Keep this for follow-up.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level wizard. Tracks the accumulated data + which step is showing.
// Each step submits its slice via onNext; the indemnity step submits the
// full payload to /api/onboarding and flips to the payment step.

// sessionStorage key — scoped per centre so a parent doing two clubs in
// two tabs doesn't cross-contaminate (rare but real). Survives a tab
// reload + accidental close + tab-restore, clears on successful submit.
function storageKey(centreSlug: string) {
  return `equiwings:onboarding:${centreSlug}`;
}

type Persisted = { stepIdx: number; data: WizardData };

function loadPersisted(centreSlug: string): Persisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(centreSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (typeof parsed.stepIdx !== "number" || !parsed.data) return null;
    return { stepIdx: parsed.stepIdx, data: parsed.data };
  } catch {
    return null;
  }
}

function savePersisted(centreSlug: string, value: Persisted) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(centreSlug), JSON.stringify(value));
  } catch {
    // Quota exceeded / private mode — fall back to in-memory only.
  }
}

function clearPersisted(centreSlug: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(centreSlug));
  } catch {
    // Best effort.
  }
}

export function OnboardingWizard({ centreSlug, centreName }: { centreSlug: string; centreName: string }) {
  // Initial state hydrates from sessionStorage on first client render —
  // useState's initializer runs once, so we read the persisted snapshot
  // exactly when it matters. SSR runs this with window===undefined and
  // gets the empty initial state, which then rehydrates on mount.
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<WizardData>({ centreSlug });
  // /api/onboarding returns { riderId, status: 'pending_approval' }.
  // There's no immediate invoice — that's created later when a centre
  // admin approves the rider. Confirmation card uses riderId as the
  // reference number the applicant can quote in follow-ups.
  const [result, setResult] = useState<{ riderId: string; status: string; feesOn?: boolean } | null>(null);
  const [restored, setRestored] = useState(false);
  // Anti-spam challenge on this public endpoint. captchaKey is bumped after a
  // CAPTCHA rejection specifically, so the user gets a fresh question: the
  // token may have expired, and retrying an expired one always fails. It is
  // NOT bumped for other errors — doing that wiped a correct answer and made
  // the next attempt fail for a second, unrelated reason.
  const [captcha, setCaptcha] = useState<CaptchaValue>(EMPTY_CAPTCHA);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaError, setCaptchaError] = useState<string | null>(null);

  // Restore in an effect (not useState init) so SSR and client agree on
  // the first render — Next would warn about hydration mismatch otherwise.
  useEffect(() => {
    const persisted = loadPersisted(centreSlug);
    if (persisted) {
      setData({ ...persisted.data, centreSlug });
      setStepIdx(persisted.stepIdx);
      setRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every state change. Skip persistence after submit-success
  // so a back-navigation doesn't restore old state for a different rider.
  useEffect(() => {
    if (result) return;
    savePersisted(centreSlug, { stepIdx, data });
  }, [centreSlug, stepIdx, data, result]);

  // Step ordering depends on whether DOB makes the rider a minor.
  // buildSteps reads data.dob, which is populated by PersonalStep (step 0)
  // — so on the very first render (idx=0) we always show Personal and
  // the rest is decided after Personal submits.
  const steps = buildSteps(data.dob);
  const stepCount = steps.length;
  const currentStep = steps[stepIdx];

  function applyStep(stepData: Partial<OnboardingInput>) {
    setData((prev) => ({ ...prev, ...stepData }));
    setStepIdx((i) => Math.min(stepCount - 1, i + 1));
  }

  // Start over — wipe persisted state + reset to step 0. Surface when a
  // restored draft turns out to be the wrong rider (e.g. parent doing
  // sibling B after finishing A on the same browser).
  function discardDraft() {
    clearPersisted(centreSlug);
    setData({ centreSlug });
    setStepIdx(0);
    setRestored(false);
  }

  function back() {
    setStepIdx((i) => Math.max(0, i - 1));
  }

  async function submitAll(indemnity: IndemnityInput) {
    const payload = { ...data, ...indemnity };
    setCaptchaError(null);
    setSubmitting(true);
    let res: Response;
    try {
      res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...captcha }),
      });
    } catch {
      // Network drop (barn wifi) — fetch rejects. Without this the button
      // stays stuck on "Working…" forever and the parent gets no feedback.
      setSubmitting(false);
      toast.error("Couldn't reach the server — check your connection and try again.");
      return;
    }
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.message ?? err.error ?? "Submission failed";
      if (err.error === "CAPTCHA_FAILED") {
        // Only a captcha rejection should cost them the question. Reloading it
        // on every failure meant an unrelated error (a duplicate rider, say)
        // also silently cleared the answer, so their next attempt failed too.
        setCaptchaKey((n) => n + 1);
        setCaptchaError(msg);
        // Everything else they typed survives — say so, because the field
        // going blank looks like the form reset itself.
        document.getElementById("captcha-answer")?.scrollIntoView({ block: "center" });
      }
      toast.error(msg);
      return;
    }
    const body = await res.json();
    // Capture the final assembled data so a Back from payment doesn't lose it.
    setData((prev) => ({ ...prev, ...indemnity }));
    setResult(body);
    // Successful submit — wipe the draft so the user doesn't see it again
    // if they come back to the page for a sibling registration.
    clearPersisted(centreSlug);
    // Payment is always the last step regardless of whether the parental
    // consent panel was in the chain.
    setStepIdx(stepCount - 1);
  }

  // Razorpay payment is no longer initiated from this wizard — the API
  // routes the rider through pending_approval, and the registration
  // invoice is created (and emailed with a payment link) when an admin
  // approves on the /enrolments page. The runRazorpayCheckout() helper
  // at the top of this file remains exported for future use but isn't
  // called from the onboarding flow.

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{STEP_TITLES[currentStep]}</CardTitle>
          <Badge variant="secondary">
            Step {stepIdx + 1} / {stepCount}
          </Badge>
        </div>
        <CardDescription>
          <div className="mt-3 flex gap-1">
            {steps.map((key, i) => (
              <div
                key={key}
                className={`h-1.5 flex-1 rounded-full ${i <= stepIdx ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* When we restored a partial draft from sessionStorage, tell the
            user so they don't wonder why fields are pre-filled. Hide once
            they submit (result is set) or discard. */}
        {restored && !result && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
            <div>
              We restored your draft from this session — your previous progress is preserved.
              Wrong rider?{" "}
              <button
                type="button"
                onClick={discardDraft}
                className="font-semibold underline hover:text-amber-950"
              >
                Start Fresh
              </button>
              .
            </div>
            <button
              type="button"
              onClick={() => setRestored(false)}
              aria-label="Dismiss"
              className="text-warning-foreground hover:text-warning-foreground"
            >
              ✕
            </button>
          </div>
        )}
        {/* Render by step key, not by index — the parental-consent panel
            shifts the index for under-18 riders. Each step gets the same
            (initial, onNext, onBack) shape so the conditional render stays
            shallow. */}
        {currentStep === "personal" && <PersonalStep initial={data} onNext={applyStep} />}
        {currentStep === "address" && <AddressStep initial={data} onNext={applyStep} onBack={back} />}
        {currentStep === "parents" && <ParentsStep initial={data} onNext={applyStep} onBack={back} />}
        {currentStep === "medical" && <MedicalStep initial={data} onNext={applyStep} onBack={back} />}
        {currentStep === "parental-consent" && (
          <ParentalConsentStep initial={data} onNext={applyStep} onBack={back} />
        )}
        {currentStep === "indemnity" && (
          <IndemnityStep
            initial={data}
            onSubmit={submitAll}
            onBack={back}
            submitting={submitting}
            captcha={captcha}
            onCaptchaChange={(v) => {
              setCaptchaError(null);
              setCaptcha(v);
            }}
            captchaKey={captchaKey}
            captchaError={captchaError}
          />
        )}
        {currentStep === "submitted" && (
          <SubmittedStep result={result} centreName={centreName} />
        )}
      </CardContent>
    </Card>
  );
}
