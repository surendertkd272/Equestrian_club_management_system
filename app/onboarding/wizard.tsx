"use client";

import { useState } from "react";
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { compressForKind } from "@/lib/image-compress";
import {
  onboardingSchema,
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
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

// Dynamically loads Razorpay's checkout SDK and opens the modal.
// Returns true if the user paid + we verified the signature; false on cancel/error.
async function runRazorpayCheckout(invoiceId: string, centreName: string): Promise<boolean> {
  // 1) Create the Razorpay order on our backend.
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

  // 2) Load checkout.js once per page.
  await loadRazorpayScript();
  const RP = (window as any).Razorpay;
  if (!RP) {
    toast.error("Razorpay SDK failed to load");
    return false;
  }

  // 3) Open modal. Promise resolves on success/cancel.
  return new Promise<boolean>((resolve) => {
    const rzp = new RP({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      name: order.name,
      description: order.description,
      order_id: order.orderId,
      prefill: order.prefill,
      theme: { color: "#177434" },
      handler: async (response: any) => {
        // 4) Verify the signature server-side before trusting "paid".
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
  if ((window as any).Razorpay) return Promise.resolve();
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

type Step = { key: string; title: string; schema: any };
const STEPS: Step[] = [
  { key: "personal", title: "Personal", schema: personalSchema },
  { key: "address", title: "Address", schema: addressSchema },
  { key: "parents", title: "Parents & Emergency", schema: parentsSchema },
  { key: "medical", title: "Medical", schema: medicalSchema },
  { key: "indemnity", title: "Indemnity e-sign", schema: indemnitySchema },
  { key: "payment", title: "Payment", schema: null },
];

export function OnboardingWizard({ centreSlug, centreName }: { centreSlug: string; centreName: string }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ riderId: string; invoiceId: string; amount: number } | null>(null);

  const methods = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    mode: "onTouched",
    defaultValues: {
      centreSlug,
      gender: "male",
    } as any,
  });

  async function next() {
    const step = STEPS[stepIdx];
    if (step.schema) {
      const values = methods.getValues();
      const r = step.schema.safeParse(values);
      if (!r.success) {
        // surface errors by re-running form validation on the displayed fields
        await methods.trigger(Object.keys(step.schema.shape) as any);
        toast.error("Please fix the highlighted fields.");
        return;
      }
    }
    setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  }

  async function submit() {
    setSubmitting(true);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(methods.getValues()),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Submission failed");
      return;
    }
    const data = await res.json();
    setResult(data);
    setStepIdx(STEPS.length - 1);
  }

  async function payNow() {
    if (!result) return;
    setSubmitting(true);

    // Prefer real Razorpay if the deployment has a public key set; otherwise fall back to mock.
    const useReal = Boolean(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID);
    if (useReal) {
      const ok = await runRazorpayCheckout(result.invoiceId, centreName);
      setSubmitting(false);
      if (ok) toast.success("Payment received. Welcome to " + centreName + "!");
      return;
    }

    // Dev fallback — mock endpoint just flips the invoice to paid without a real gateway hop.
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
    <FormProvider {...methods}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{STEPS[stepIdx].title}</CardTitle>
            <Badge variant="secondary">
              Step {stepIdx + 1} / {STEPS.length}
            </Badge>
          </div>
          <CardDescription>
            <div className="mt-3 flex gap-1">
              {STEPS.map((s, i) => (
                <div
                  key={s.key}
                  className={`h-1.5 flex-1 rounded-full ${i <= stepIdx ? "bg-primary" : "bg-muted"}`}
                />
              ))}
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {stepIdx === 0 && <PersonalStep />}
          {stepIdx === 1 && <AddressStep />}
          {stepIdx === 2 && <ParentsStep />}
          {stepIdx === 3 && <MedicalStep />}
          {stepIdx === 4 && <IndemnityStep />}
          {stepIdx === 5 && <PaymentStep result={result} onPay={payNow} submitting={submitting} centreName={centreName} />}

          <div className="flex items-center justify-between border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              disabled={stepIdx === 0 || submitting || !!result}
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            {stepIdx < STEPS.length - 2 && (
              <Button type="button" onClick={next}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {stepIdx === STEPS.length - 2 && (
              <Button type="button" onClick={submit} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit & continue to payment"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </FormProvider>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  required,
}: {
  name: keyof OnboardingInput;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const { register, formState } = useFormContext<OnboardingInput>();
  const error = (formState.errors as any)[name]?.message as string | undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name as string}>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <Input id={name as string} type={type} placeholder={placeholder} {...register(name as any)} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PersonalStep() {
  const { register, formState } = useFormContext<OnboardingInput>();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field name="firstName" label="First name" required />
      <Field name="lastName" label="Last name" required />
      <Field name="dob" label="Date of birth" type="date" required />
      <div className="space-y-1.5">
        <Label>Gender *</Label>
        <Select {...register("gender")}>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </Select>
      </div>
      <Field name="mobile" label="Mobile" required placeholder="10-digit" />
      <Field name="email" label="Email" type="email" />
      <Field name="aadhaarNo" label="Aadhaar (12 digits)" placeholder="123412341234" />
      <Field name="placeOfBirth" label="Place of birth" />
      <Field name="nationality" label="Nationality" placeholder="Indian" />
      <Field name="maritalStatus" label="Marital status" />
      <Field name="school" label="School" placeholder="School / college name" />
      <Field name="education" label="Education" />
      <Field name="occupation" label="Occupation" />

      <div className="md:col-span-2 grid gap-3 md:grid-cols-2 rounded-md border bg-muted/30 p-3">
        <UploadField
          name="photoUrl"
          label="Photo"
          kind="rider_photo"
          accept="image/jpeg,image/png,image/webp"
          hint="JPG / PNG / WebP, up to 5 MB"
        />
        <UploadField
          name="aadhaarDocUrl"
          label="Aadhaar scan / PDF"
          kind="rider_aadhaar"
          accept="image/jpeg,image/png,application/pdf"
          hint="JPG / PNG / PDF, up to 5 MB. Encrypted at rest in production."
        />
      </div>
    </div>
  );
}

function UploadField({
  name,
  label,
  kind,
  accept,
  hint,
}: {
  name: keyof OnboardingInput;
  label: string;
  kind: "rider_photo" | "rider_aadhaar";
  accept: string;
  hint?: string;
}) {
  const { register, setValue, watch } = useFormContext<OnboardingInput>();
  const value = watch(name as any) as string | undefined;
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
      setValue(name as any, data.url, { shouldDirty: true });
      setBusy(false);
    } catch {
      setErr("Network error");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {/* Hidden field so react-hook-form holds the resolved URL */}
      <input type="hidden" {...register(name as any)} />
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

function AddressStep() {
  return (
    <div className="grid gap-4">
      <div className="space-y-1.5">
        <Label>Present address *</Label>
        <AddressTextarea name="addressPresent" />
      </div>
      <div className="space-y-1.5">
        <Label>Permanent address (leave blank if same)</Label>
        <AddressTextarea name="addressPermanent" />
      </div>
      <div className="max-w-xs">
        <Field name="pincode" label="Pincode" required placeholder="201001" />
      </div>
    </div>
  );
}

function AddressTextarea({ name }: { name: keyof OnboardingInput }) {
  const { register, formState } = useFormContext<OnboardingInput>();
  const error = (formState.errors as any)[name]?.message as string | undefined;
  return (
    <>
      <Textarea {...register(name as any)} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}

function ParentsStep() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field name="fatherName" label="Father's name" />
      <Field name="fatherPhone" label="Father's phone" />
      <Field name="motherName" label="Mother's name" />
      <Field name="motherPhone" label="Mother's phone" />
      <Field name="emergencyName" label="Emergency contact name" required />
      <Field name="emergencyPhone" label="Emergency contact phone" required />
    </div>
  );
}

function MedicalStep() {
  const { watch } = useFormContext<OnboardingInput>();
  const h = watch("heightCm" as any);
  const w = watch("weightKg" as any);
  const bmi = calcBmi(Number(h) || null, Number(w) || null);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field name="heightCm" label="Height (cm)" type="number" required />
        <Field name="weightKg" label="Weight (kg)" type="number" required />
        <div className="space-y-1.5">
          <Label>BMI (auto)</Label>
          <div className="flex h-10 items-center rounded-md border bg-muted px-3 text-sm">{bmi ?? "—"}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Medical conditions</Label>
        <MedicalTextarea name="medicalNotes" placeholder="Asthma, prior fractures, etc." />
      </div>
      <div className="space-y-1.5">
        <Label>Allergies</Label>
        <MedicalTextarea name="allergies" placeholder="Drugs, food, dust, hay…" />
      </div>
    </div>
  );
}

function MedicalTextarea({ name, placeholder }: { name: keyof OnboardingInput; placeholder?: string }) {
  const { register } = useFormContext<OnboardingInput>();
  return <Textarea placeholder={placeholder} {...register(name as any)} />;
}

function IndemnityStep() {
  const { register, formState } = useFormContext<OnboardingInput>();
  const fullNameError = (formState.errors as any).fullNameSignature?.message;
  const agreedError = (formState.errors as any).agreed?.message;
  const nocError = (formState.errors as any).injuryNocAgreed?.message;
  return (
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
          <input type="checkbox" className="mt-1" {...register("injuryNocAgreed" as any)} />
          <span>I agree to the NOC for injuries (digital consent).</span>
        </label>
        {nocError && <p className="mt-1 text-xs text-destructive">{nocError as string}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fullNameSignature">Type your full name to sign *</Label>
        <Input id="fullNameSignature" placeholder="Full legal name" {...register("fullNameSignature" as any)} />
        {fullNameError && <p className="text-xs text-destructive">{fullNameError as string}</p>}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" {...register("agreed" as any)} />
        <span>
          I have read and agree to the indemnity above. I understand my electronic signature will be recorded with
          timestamp and IP address as legal proof of consent.
        </span>
      </label>
      {agreedError && <p className="text-xs text-destructive">{agreedError as string}</p>}
    </div>
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
