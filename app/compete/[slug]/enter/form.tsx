"use client";

import { useEffect, useState } from "react";

type Cls = { name: string; fee: number | null };

// Public entry form. CAPTCHA fetched on mount; form posts back to the
// public entries endpoint. Magic-link verification handles the bot/spam
// surface beyond CAPTCHA — even an automated submit needs a working
// inbox to convert into a real entry.
export function EntryForm({ slug, classes, scope }: { slug: string; classes: Cls[]; scope: string }) {
  const [form, setForm] = useState({
    className: classes[0]?.name ?? "",
    firstName: "",
    lastName: "",
    email: "",
    mobile: "",
    dob: "",
    parentName: "",
    parentRelation: "father",
    parentPhone: "",
    parentConsentAgreed: false,
    accreditationBody: "",
    accreditationNumber: "",
    accreditationExpiry: "",
    horseName: "",
    horseBreed: "",
    horseHeightHh: "",
    captchaToken: "",
    captchaAnswer: "",
  });
  const [captchaQuestion, setCaptchaQuestion] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/captcha")
      .then((r) => r.json())
      .then((d) => {
        setCaptchaQuestion(d.question);
        setForm((f) => ({ ...f, captchaToken: d.token }));
      })
      .catch(() => setError("Couldn't load the form. Please refresh."));
  }, []);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/public/competitions/${slug}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        horseHeightHh: form.horseHeightHh ? Number(form.horseHeightHh) : undefined,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        data.error === "CAPTCHA_FAILED" ? "CAPTCHA answer was wrong."
        : data.error === "ENTRIES_CLOSED" ? "Entries are closed."
        : data.error === "PARENTAL_CONSENT_REQUIRED" ? "Riders under 18 need parental consent — fill the parent section."
        : data.error === "ACCREDITATION_REQUIRED" ? "This scope requires a federation accreditation number."
        : data.message ?? "Submission failed."
      );
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 p-5 text-sm">
        <h2 className="font-semibold text-emerald-900">Almost done — check your email.</h2>
        <p className="mt-2 text-emerald-800">
          We sent a confirmation link to <strong>{form.email}</strong>. Click it within 48 hours to confirm your entry.
        </p>
        <p className="mt-2 text-emerald-800">
          After you confirm, the organiser reviews your details. You'll get a second email when you're on the start list.
        </p>
      </div>
    );
  }

  const isMinor = form.dob ? (new Date().getFullYear() - new Date(form.dob).getFullYear()) < 18 : false;
  const needsAccreditation = scope === "state" || scope === "national";

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">Class</h3>
        <select
          value={form.className}
          onChange={(e) => set("className", e.target.value)}
          className="mt-2 h-10 w-full rounded border bg-card px-2 text-sm"
        >
          {classes.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}{c.fee !== null ? ` · ₹${c.fee.toLocaleString("en-IN")}` : ""}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">Rider details</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="First name" value={form.firstName} onChange={(v) => set("firstName", v)} required />
          <Field label="Last name" value={form.lastName} onChange={(v) => set("lastName", v)} required />
          <Field label="Email" value={form.email} onChange={(v) => set("email", v)} type="email" required />
          <Field label="Mobile" value={form.mobile} onChange={(v) => set("mobile", v)} required />
          <Field label="Date of birth" value={form.dob} onChange={(v) => set("dob", v)} type="date" />
        </div>
      </section>

      {isMinor && (
        <section className="rounded-lg border bg-amber-50 p-5">
          <h3 className="text-sm font-semibold">Parental consent (under 18)</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            DPDPA Section 9 requires verifiable parental consent for minors.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Parent / guardian name" value={form.parentName} onChange={(v) => set("parentName", v)} required />
            <div>
              <label className="text-xs font-medium">Relationship</label>
              <select
                value={form.parentRelation}
                onChange={(e) => set("parentRelation", e.target.value as any)}
                className="mt-1 h-10 w-full rounded border bg-card px-2 text-sm"
              >
                <option value="father">Father</option>
                <option value="mother">Mother</option>
                <option value="guardian">Legal guardian</option>
              </select>
            </div>
            <Field label="Parent phone" value={form.parentPhone} onChange={(v) => set("parentPhone", v)} required />
          </div>
          <label className="mt-3 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.parentConsentAgreed}
              onChange={(e) => set("parentConsentAgreed", e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I am the parent / legal guardian and consent to my child's participation, processing of personal data, and the medical/safety arrangements of the event.
            </span>
          </label>
        </section>
      )}

      {needsAccreditation && (
        <section className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold">Federation accreditation</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Required for {scope}-scope events.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Body" value={form.accreditationBody} onChange={(v) => set("accreditationBody", v)} placeholder="EFI / BHS / FEI" />
            <Field label="Membership number" value={form.accreditationNumber} onChange={(v) => set("accreditationNumber", v)} />
            <Field label="Expiry" value={form.accreditationExpiry} onChange={(v) => set("accreditationExpiry", v)} type="date" />
          </div>
        </section>
      )}

      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">Horse</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Horse name" value={form.horseName} onChange={(v) => set("horseName", v)} />
          <Field label="Breed" value={form.horseBreed} onChange={(v) => set("horseBreed", v)} />
          <Field label="Height (hands)" value={form.horseHeightHh} onChange={(v) => set("horseHeightHh", v)} type="number" />
        </div>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">Quick check</h3>
        <p className="mt-2 text-sm">
          What is <strong>{captchaQuestion}</strong>?
        </p>
        <input
          value={form.captchaAnswer}
          onChange={(e) => set("captchaAnswer", e.target.value)}
          className="mt-2 h-10 w-32 rounded border bg-card px-2 text-sm"
          required
        />
      </section>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit entry"}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium">{label}{required && " *"}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded border bg-card px-2 text-sm"
      />
    </div>
  );
}
