"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";

type Row = {
  key: string;
  label: string;
  tagline: string;
  monthlyInr: number;
  annualInrPerMonth: number;
  highlight: boolean;
  isVisible: boolean;
  razorpayPlanIdMonthly: string | null;
  razorpayPlanIdAnnual: string | null;
  sortOrder: number;
};

export function PricingForm({ initial }: { initial: Row }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Row>(k: K, v: Row[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setBusy(true);
    const res = await patchJson(`/api/owner/pricing/${initial.key}`, {
      label: form.label,
      tagline: form.tagline,
      monthlyInr: Number(form.monthlyInr),
      annualInrPerMonth: Number(form.annualInrPerMonth),
      highlight: form.highlight,
      isVisible: form.isVisible,
      razorpayPlanIdMonthly: form.razorpayPlanIdMonthly || null,
      razorpayPlanIdAnnual: form.razorpayPlanIdAnnual || null,
      sortOrder: Number(form.sortOrder),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Saved.");
    router.refresh();
  }

  const annualSavings = form.monthlyInr > 0
    ? Math.round(((form.monthlyInr - form.annualInrPerMonth) / form.monthlyInr) * 100)
    : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Display label" value={form.label} onChange={(v) => set("label", v)} />
      <Field label="Sort order" type="number" value={String(form.sortOrder)} onChange={(v) => set("sortOrder", Number(v))} />
      <div className="md:col-span-2">
        <Field label="Tagline" value={form.tagline} onChange={(v) => set("tagline", v)} />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Monthly price (₹)</Label>
        <Input aria-label="Monthly price (₹)"
          type="number"
          value={form.monthlyInr}
          onChange={(e) => set("monthlyInr", Number(e.target.value))}
          className="border-border bg-background text-foreground"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Annual price (₹/month when billed annually)</Label>
        <Input aria-label="Annual price (₹/month when billed annually)"
          type="number"
          value={form.annualInrPerMonth}
          onChange={(e) => set("annualInrPerMonth", Number(e.target.value))}
          className="border-border bg-background text-foreground"
        />
        {annualSavings > 0 && (
          <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
            Public page shows ≈ {annualSavings}% annual discount
          </div>
        )}
      </div>

      <Field
        label="Razorpay plan id · Monthly"
        value={form.razorpayPlanIdMonthly ?? ""}
        onChange={(v) => set("razorpayPlanIdMonthly", v)}
        placeholder="plan_NCxxxxxxxxxxxx"
        mono
      />
      <Field
        label="Razorpay plan id · Annual"
        value={form.razorpayPlanIdAnnual ?? ""}
        onChange={(v) => set("razorpayPlanIdAnnual", v)}
        placeholder="plan_NCxxxxxxxxxxxx"
        mono
      />

      <div className="flex items-center gap-6 md:col-span-2">
        <Toggle
          label="Highlight as most popular"
          on={form.highlight}
          onChange={(v) => set("highlight", v)}
        />
        <Toggle
          label="Visible on public page"
          on={form.isVisible}
          onChange={(v) => set("isVisible", v)}
        />
      </div>

      <div className="md:col-span-2 flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`border-border bg-background text-foreground ${mono ? "font-mono text-xs" : ""}`}
      />
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
      <span
        role="switch"
        aria-checked={on}
        tabIndex={0}
        onClick={() => onChange(!on)}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onChange(!on)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
          on ? "border-emerald-400 bg-emerald-500" : "border-border bg-muted"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-md transition-transform ${
            on ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </span>
      {label}
    </label>
  );
}
