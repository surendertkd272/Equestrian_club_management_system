"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PLAN_REGISTRY, type PlanKey } from "@/lib/plans";

type Step = 1 | 2 | 3;

type Form = {
  // Step 1
  name: string;
  slug: string;
  plan: PlanKey;
  contactName: string;
  billingEmail: string;
  phone: string;
  // Step 2
  centreName: string;
  centreSlug: string;
  centreAddress: string;
  // Step 3
  adminName: string;
  adminEmail: string;
  adminPhone: string;
};

const EMPTY: Form = {
  name: "", slug: "", plan: "starter",
  contactName: "", billingEmail: "", phone: "",
  centreName: "", centreSlug: "", centreAddress: "",
  adminName: "", adminEmail: "", adminPhone: "",
};

type Created = {
  orgId: string;
  centreId: string;
  superAdminId: string;
  superAdminEmail: string;
  tempPassword: string;
  tenantSlug: string;
  tenantName: string;
};

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const set = <K extends keyof Form>(key: K, v: Form[K]) => setForm((f) => ({ ...f, [key]: v }));

  const planFeaturesPreview = useMemo(() => {
    return PLAN_REGISTRY[form.plan].features;
  }, [form.plan]);

  function step1Valid() {
    return form.name.trim().length >= 2 && /^[a-z][a-z0-9-]*[a-z0-9]$/.test(form.slug.trim());
  }
  function step2Valid() {
    return form.centreName.trim().length >= 2 && /^[a-z][a-z0-9-]*[a-z0-9]$/.test(form.centreSlug.trim());
  }
  function step3Valid() {
    return (
      form.adminName.trim().length >= 2 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail.trim())
    );
  }

  async function submit() {
    if (!step1Valid() || !step2Valid() || !step3Valid()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/owner/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim(),
          plan: form.plan,
          contactName: form.contactName.trim() || undefined,
          billingEmail: form.billingEmail.trim() || undefined,
          phone: form.phone.trim() || undefined,
          centre: {
            name: form.centreName.trim(),
            slug: form.centreSlug.trim(),
            address: form.centreAddress.trim() || undefined,
          },
          superAdmin: {
            name: form.adminName.trim(),
            email: form.adminEmail.trim(),
            phone: form.adminPhone.trim() || undefined,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "ORG_SLUG_TAKEN" ? "Tenant slug already in use."
          : data.error === "CENTRE_SLUG_TAKEN" ? "Centre slug already in use across the platform."
          : data.error === "EMAIL_TAKEN" ? "That admin email already belongs to another user."
          : data.error === "VALIDATION" ? "Some fields are invalid — go back and check each step."
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      setCreated({
        orgId: data.orgId,
        centreId: data.centreId,
        superAdminId: data.superAdminId,
        superAdminEmail: data.superAdminEmail,
        tempPassword: data.tempPassword,
        tenantSlug: form.slug.trim(),
        tenantName: form.name.trim(),
      });
      toast.success("Tenant provisioned");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return <SuccessCard created={created} onDone={() => router.push(`/owner/tenants/${created.orgId}`)} />;
  }

  return (
    <div className="space-y-6">
      <StepHeader step={step} />

      <div className="rounded-lg border border-border bg-card p-5">
        {step === 1 && (
          <Step1
            form={form}
            set={set}
            planFeatures={planFeaturesPreview}
          />
        )}
        {step === 2 && <Step2 form={form} set={set} />}
        {step === 3 && <Step3 form={form} set={set} />}
      </div>

      <div className="flex items-center justify-between">
        <div>
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep((s) => (s - 1) as Step)}
              disabled={busy}
              className="border-border text-foreground hover:bg-muted"
            >
              Back
            </Button>
          )}
          {step === 1 && (
            <Link
              href="/owner/tenants"
              className="text-sm text-muted-foreground hover:underline"
            >
              Cancel
            </Link>
          )}
        </div>
        <div>
          {step < 3 && (
            <Button
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={step === 1 ? !step1Valid() : !step2Valid()}
            >
              Continue
            </Button>
          )}
          {step === 3 && (
            <Button onClick={submit} disabled={busy || !step3Valid()}>
              {busy ? "Provisioning…" : "Create tenant"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepHeader({ step }: { step: Step }) {
  const labels = ["Tenant", "First centre", "First super admin"];
  return (
    <ol className="flex items-center gap-2 text-sm">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        const active = n === step;
        const done = n < step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                done ? "border-emerald-500 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                : active ? "border-border bg-muted text-foreground"
                : "border-border text-muted-foreground"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            {i < labels.length - 1 && <span className="text-foreground mx-1">·</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-foreground">{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const inputCls = "border-border bg-background text-foreground";

function Step1({
  form,
  set,
  planFeatures,
}: {
  form: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  planFeatures: readonly string[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="t-name" label="Tenant name" hint='e.g. "Royal Riders Academy"'>
        <Input id="t-name" value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
      </Field>
      <Field
        id="t-slug"
        label="Tenant slug"
        hint="URL-safe identifier — lowercase + hyphens, immutable after creation"
      >
        <Input
          id="t-slug"
          value={form.slug}
          onChange={(e) => set("slug", e.target.value.toLowerCase())}
          className={inputCls}
          placeholder="royal-riders"
        />
      </Field>

      <div className="sm:col-span-2">
        <Label htmlFor="t-plan" className="text-foreground">Plan</Label>
        <select
          id="t-plan"
          value={form.plan}
          onChange={(e) => set("plan", e.target.value as PlanKey)}
          className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="starter">Starter — 1 centre, basic ops</option>
          <option value="pro">Pro — up to 5 centres, parent + student portals</option>
          <option value="enterprise">Enterprise — unlimited centres, competitions + exams + à-la-carte</option>
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          {planFeatures.length} features will be enabled on creation.
        </p>
      </div>

      <Field id="t-contact" label="Contact name (optional)">
        <Input id="t-contact" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} className={inputCls} />
      </Field>
      <Field id="t-billing" label="Billing email (optional)">
        <Input id="t-billing" type="email" value={form.billingEmail} onChange={(e) => set("billingEmail", e.target.value)} className={inputCls} />
      </Field>
      <Field id="t-phone" label="Phone (optional)">
        <Input id="t-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} />
      </Field>
    </div>
  );
}

function Step2({
  form,
  set,
}: {
  form: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2 rounded border border-border bg-background p-3 text-xs text-muted-foreground">
        Every tenant starts with one centre. You can add more later (subject to the plan's cap).
      </div>
      <Field id="c-name" label="Centre name">
        <Input id="c-name" value={form.centreName} onChange={(e) => set("centreName", e.target.value)} className={inputCls} placeholder="HQ Centre" />
      </Field>
      <Field
        id="c-slug"
        label="Centre slug"
        hint="Global across the platform — used in public onboarding URLs"
      >
        <Input
          id="c-slug"
          value={form.centreSlug}
          onChange={(e) => set("centreSlug", e.target.value.toLowerCase())}
          className={inputCls}
          placeholder="royal-riders-hq"
        />
      </Field>
      <Field id="c-addr" label="Address (optional)">
        <Input id="c-addr" value={form.centreAddress} onChange={(e) => set("centreAddress", e.target.value)} className={inputCls} placeholder="Street, city, state" />
      </Field>
    </div>
  );
}

function Step3({
  form,
  set,
}: {
  form: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2 rounded border border-border bg-background p-3 text-xs text-muted-foreground">
        This person becomes the tenant's HQ super admin — they manage everything inside the
        tenant. You'll get a one-time temp password to share with them on the next screen.
      </div>
      <Field id="a-name" label="Full name">
        <Input id="a-name" value={form.adminName} onChange={(e) => set("adminName", e.target.value)} className={inputCls} />
      </Field>
      <Field id="a-email" label="Email">
        <Input id="a-email" type="email" value={form.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} className={inputCls} />
      </Field>
      <Field id="a-phone" label="Phone (optional)">
        <Input id="a-phone" value={form.adminPhone} onChange={(e) => set("adminPhone", e.target.value)} className={inputCls} />
      </Field>
    </div>
  );
}

function SuccessCard({ created, onDone }: { created: Created; onDone: () => void }) {
  async function copy() {
    await navigator.clipboard.writeText(created.tempPassword);
    toast.success("Password copied");
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-50 dark:bg-emerald-950/30 p-5">
        <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          ✓ {created.tenantName} provisioned
        </div>
        <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-800 dark:text-emerald-200/80">
          Org slug <code className="rounded bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5">{created.tenantSlug}</code> is live.
          Share these credentials with the new super admin — the temp password is shown <strong>once</strong>.
        </p>
      </div>

      <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-50 dark:bg-amber-950/30 p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          Hand off to the new admin
        </div>
        <div className="mt-2 space-y-1 font-mono text-sm text-amber-900 dark:text-amber-100">
          <div>
            <span className="text-amber-700 dark:text-amber-400">Login URL:</span>{" "}
            <code className="rounded bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5">/login</code>
          </div>
          <div>
            <span className="text-amber-700 dark:text-amber-400">Email:</span>{" "}
            <code className="rounded bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5">{created.superAdminEmail}</code>
          </div>
          <div>
            <span className="text-amber-700 dark:text-amber-400">Temp password:</span>{" "}
            <code className="rounded bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 font-bold">{created.tempPassword}</code>
            <button
              type="button"
              onClick={copy}
              className="ml-2 rounded border border-amber-300 dark:border-amber-700 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:bg-amber-900"
            >
              Copy
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-700 dark:text-amber-300/80">
          Shown once. Ask the admin to change their password after first sign-in.
        </p>
      </div>

      <div className="flex gap-2">
        <Button onClick={onDone}>Open tenant detail</Button>
        <Link
          href="/owner/tenants"
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm text-foreground hover:bg-muted"
        >
          Back to tenants list
        </Link>
      </div>
    </div>
  );
}
