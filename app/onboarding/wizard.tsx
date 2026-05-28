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

import { useState } from "react";
import { useForm, type UseFormReturn, type FieldValues, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { compressForKind } from "@/lib/image-compress";
import {
  personalSchema,
  addressSchema,
  parentsSchema,
  medicalSchema,
  indemnitySchema,
  type OnboardingInput,
} from "@/lib/schemas/rider-onboarding";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { calcBmi } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay — checkout.js loaded via <script>, lives on window.Razorpay. Types
// cover exactly the surface we touch; nothing more (third-party shapes drift).

type RazorpayResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (response: RazorpayResponse) => void | Promise<void>;
  modal?: { ondismiss?: () => void };
};
type RazorpayInstance = { open: () => void };
type RazorpayConstructor = new (opts: RazorpayOptions) => RazorpayInstance;
declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

async function runRazorpayCheckout(invoiceId: string, centreName: string): Promise<boolean> {
  const orderRes = await fetch("/api/payments/razorpay/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceId }),
  });
  if (!orderRes.ok) {
    const err = await orderRes.json().catch(() => ({}));
    toast.error(err.message ?? err.error ?? "Could not start payment");
    return false;
  }
  const order = await orderRes.json();

  await loadRazorpayScript();
  const RP = window.Razorpay;
  if (!RP) {
    toast.error("Razorpay SDK failed to load");
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const rzp = new RP({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      name: order.name,
      description: order.description ?? `Registration · ${centreName}`,
      order_id: order.orderId,
      prefill: order.prefill,
      theme: { color: "#177434" },
      handler: async (response) => {
        const v = await fetch("/api/payments/razorpay/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });
        if (!v.ok) {
          toast.error("Payment captured but verification failed — Equiwings staff will contact you.");
          resolve(false);
          return;
        }
        resolve(true);
      },
      modal: {
        ondismiss: () => resolve(false),
      },
    });
    rzp.open();
  });
}

let razorpayScriptPromise: Promise<void> | null = null;
function loadRazorpayScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Razorpay script failed to load"));
    document.body.appendChild(s);
  });
  return razorpayScriptPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-step input types — inferred from the Zod schemas, no manual sync needed.

type PersonalInput = z.infer<typeof personalSchema>;
type AddressInput = z.infer<typeof addressSchema>;
type ParentsInput = z.infer<typeof parentsSchema>;
type MedicalInput = z.infer<typeof medicalSchema>;
type IndemnityInput = z.infer<typeof indemnitySchema>;

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

const STEP_LABELS = ["Personal", "Address", "Parents & Emergency", "Medical", "Indemnity e-sign", "Payment"] as const;
const STEP_COUNT = STEP_LABELS.length;

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
}: {
  methods: UseFormReturn<T>;
  name: FieldPath<T>;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const { register, formState } = methods;
  // rhf nests errors by path; for top-level keys (which is all we have) the
  // direct read is safe. Cast through unknown because FieldErrors's value
  // type is recursive and TS can't infer the leaf shape here.
  const err = (formState.errors[name] as { message?: string } | undefined)?.message;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <Input id={name} type={type} placeholder={placeholder} {...register(name)} />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function TextareaField<T extends FieldValues>({
  methods,
  name,
  placeholder,
}: {
  methods: UseFormReturn<T>;
  name: FieldPath<T>;
  placeholder?: string;
}) {
  const { register, formState } = methods;
  const err = (formState.errors[name] as { message?: string } | undefined)?.message;
  return (
    <>
      <Textarea placeholder={placeholder} {...register(name)} />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </>
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
        <p className="text-[11px] text-emerald-700">
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
}: {
  onBack?: () => void;
  canBack: boolean;
  submitting: boolean;
  submitLabel: string;
}) {
  return (
    <div className="flex items-center justify-between border-t pt-4">
      <Button type="button" variant="outline" onClick={onBack} disabled={!canBack || submitting}>
        <ChevronLeft className="h-4 w-4" /> Back
      </Button>
      <Button type="submit" disabled={submitting}>
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
        <Field methods={methods} name="firstName" label="First name" required />
        <Field methods={methods} name="lastName" label="Last name" required />
        <Field methods={methods} name="dob" label="Date of birth" type="date" required />
        <div className="space-y-1.5">
          <Label>Gender *</Label>
          <Select {...methods.register("gender")}>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <Field methods={methods} name="mobile" label="Mobile" required placeholder="10-digit" />
        <Field methods={methods} name="email" label="Email" type="email" />
        <Field methods={methods} name="aadhaarNo" label="Aadhaar (12 digits)" placeholder="123412341234" />
        <Field methods={methods} name="placeOfBirth" label="Place of birth" />
        <Field methods={methods} name="nationality" label="Nationality" placeholder="Indian" />
        <Field methods={methods} name="maritalStatus" label="Marital status" />
        <Field methods={methods} name="school" label="School" placeholder="School / college name" />
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
            label="Aadhaar scan / PDF"
            kind="rider_aadhaar"
            accept="image/jpeg,image/png,application/pdf"
            hint="JPG / PNG / PDF, up to 5 MB. Encrypted at rest in production."
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
        <div className="space-y-1.5">
          <Label>Present address *</Label>
          <TextareaField methods={methods} name="addressPresent" />
        </div>
        <div className="space-y-1.5">
          <Label>Permanent address (leave blank if same)</Label>
          <TextareaField methods={methods} name="addressPermanent" />
        </div>
        <div className="max-w-xs">
          <Field methods={methods} name="pincode" label="Pincode" required placeholder="201001" />
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
        <Field methods={methods} name="fatherName" label="Father's name" />
        <Field methods={methods} name="fatherPhone" label="Father's phone" />
        <Field methods={methods} name="motherName" label="Mother's name" />
        <Field methods={methods} name="motherPhone" label="Mother's phone" />
        <Field methods={methods} name="emergencyName" label="Emergency contact name" required />
        <Field methods={methods} name="emergencyPhone" label="Emergency contact phone" required />
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
          <Field methods={methods} name="heightCm" label="Height (cm)" type="number" required />
          <Field methods={methods} name="weightKg" label="Weight (kg)" type="number" required />
          <div className="space-y-1.5">
            <Label>BMI (auto)</Label>
            <div className="flex h-10 items-center rounded-md border bg-muted px-3 text-sm">{bmi ?? "—"}</div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Medical conditions</Label>
          <TextareaField methods={methods} name="medicalNotes" placeholder="Asthma, prior fractures, etc." />
        </div>
        <div className="space-y-1.5">
          <Label>Allergies</Label>
          <TextareaField methods={methods} name="allergies" placeholder="Drugs, food, dust, hay…" />
        </div>
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
}: {
  initial: WizardData;
  onSubmit: (d: IndemnityInput) => void | Promise<void>;
  onBack: () => void;
  submitting: boolean;
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
        <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed">
          <p className="font-semibold text-amber-900">NOC for injuries</p>
          <p className="mt-2 text-amber-900">
            I (the rider, or parent/guardian for minors) give my No-Objection Consent for the rider to participate
            in horse-riding activity at this centre. I acknowledge that riding involves a real risk of injury —
            falls, kicks, bites, equipment failure, and unpredictable horse behaviour can occur even under qualified
            supervision. I will not hold Equiwings, the centre, its coaches, grooms, or contractors liable for
            injuries sustained in the normal course of training, competition, or stable work. Centre staff will
            still administer reasonable first aid and authorise emergency medical care if needed.
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm font-medium text-amber-900">
            <input type="checkbox" className="mt-1" {...methods.register("injuryNocAgreed")} />
            <span>I agree to the NOC for injuries (digital consent).</span>
          </label>
          {nocError && <p className="mt-1 text-xs text-destructive">{nocError}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fullNameSignature">Type your full name to sign *</Label>
          <Input id="fullNameSignature" placeholder="Full legal name" {...methods.register("fullNameSignature")} />
          {fullNameError && <p className="text-xs text-destructive">{fullNameError}</p>}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" {...methods.register("agreed")} />
          <span>
            I have read and agree to the indemnity above. I understand my electronic signature will be recorded with
            timestamp and IP address as legal proof of consent.
          </span>
        </label>
        {agreedError && <p className="text-xs text-destructive">{agreedError}</p>}
      </div>
      <StepFooter canBack onBack={onBack} submitting={submitting} submitLabel="Submit & continue to payment" />
    </form>
  );
}

function PaymentStep({
  result,
  onPay,
  submitting,
  centreName,
}: {
  result: { riderId: string; invoiceId: string; amount: number } | null;
  onPay: () => void;
  submitting: boolean;
  centreName: string;
}) {
  if (!result) {
    return (
      <div className="rounded-md border bg-muted p-4 text-sm text-muted-foreground">
        Click <b>Submit & continue to payment</b> on the previous step to generate your invoice.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Registration fee — {centreName}</div>
            <div className="text-2xl font-bold">₹{result.amount.toLocaleString("en-IN")}</div>
          </div>
          <Badge variant="warning">Pending</Badge>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Invoice ID: <code>{result.invoiceId}</code>
        </p>
      </div>
      <Button onClick={onPay} disabled={submitting} size="lg" className="w-full">
        {submitting
          ? "Processing…"
          : process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
          ? "Pay now (UPI · Card · Netbanking)"
          : "Pay now (mock Razorpay — dev only)"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        {process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
          ? "Secure payment via Razorpay. We never store card details."
          : "Set NEXT_PUBLIC_RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET to switch this to a real gateway."}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level wizard. Tracks the accumulated data + which step is showing.
// Each step submits its slice via onNext; the indemnity step submits the
// full payload to /api/onboarding and flips to the payment step.

export function OnboardingWizard({ centreSlug, centreName }: { centreSlug: string; centreName: string }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<WizardData>({ centreSlug });
  const [result, setResult] = useState<{ riderId: string; invoiceId: string; amount: number } | null>(null);

  function applyStep(stepData: Partial<OnboardingInput>) {
    setData((prev) => ({ ...prev, ...stepData }));
    setStepIdx((i) => Math.min(STEP_COUNT - 1, i + 1));
  }

  function back() {
    setStepIdx((i) => Math.max(0, i - 1));
  }

  async function submitAll(indemnity: IndemnityInput) {
    const payload = { ...data, ...indemnity };
    setSubmitting(true);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Submission failed");
      return;
    }
    const body = await res.json();
    // Capture the final assembled data so a Back from payment doesn't lose it.
    setData((prev) => ({ ...prev, ...indemnity }));
    setResult(body);
    setStepIdx(STEP_COUNT - 1);
  }

  async function payNow() {
    if (!result) return;
    setSubmitting(true);

    const useReal = Boolean(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID);
    if (useReal) {
      const ok = await runRazorpayCheckout(result.invoiceId, centreName);
      setSubmitting(false);
      if (ok) toast.success("Payment received. Welcome to " + centreName + "!");
      return;
    }

    // Dev fallback — mock endpoint flips the invoice to paid without a real gateway hop.
    const res = await fetch("/api/payments/razorpay/mock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: result.invoiceId }),
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error("Payment failed");
      return;
    }
    toast.success("Payment received (mock). Welcome to " + centreName + "!");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{STEP_LABELS[stepIdx]}</CardTitle>
          <Badge variant="secondary">
            Step {stepIdx + 1} / {STEP_COUNT}
          </Badge>
        </div>
        <CardDescription>
          <div className="mt-3 flex gap-1">
            {STEP_LABELS.map((label, i) => (
              <div
                key={label}
                className={`h-1.5 flex-1 rounded-full ${i <= stepIdx ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {stepIdx === 0 && <PersonalStep initial={data} onNext={applyStep} />}
        {stepIdx === 1 && <AddressStep initial={data} onNext={applyStep} onBack={back} />}
        {stepIdx === 2 && <ParentsStep initial={data} onNext={applyStep} onBack={back} />}
        {stepIdx === 3 && <MedicalStep initial={data} onNext={applyStep} onBack={back} />}
        {stepIdx === 4 && (
          <IndemnityStep initial={data} onSubmit={submitAll} onBack={back} submitting={submitting} />
        )}
        {stepIdx === 5 && (
          <PaymentStep result={result} onPay={payNow} submitting={submitting} centreName={centreName} />
        )}
      </CardContent>
    </Card>
  );
}
