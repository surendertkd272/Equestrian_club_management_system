"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { CaptchaField, EMPTY_CAPTCHA, type CaptchaValue } from "@/components/captcha-field";
import { postJson } from "@/lib/client/post-json";

// Four fields, not the owner wizard's three steps.
//
// The owner-operated wizard asks for org name, org slug, centre name, centre
// slug, plan and admin details, because the person filling it in is staffing a
// sale. Someone signing their own club up is not — every extra field is a
// chance to leave. Slugs are derived server-side, the first centre takes the
// club's name, and the plan starts on a trial; all of it stays editable in
// Settings afterwards.
export function SignupForm() {
  const router = useRouter();
  const [clubName, setClubName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaValue>(EMPTY_CAPTCHA);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setBusy(true);
    const res = await postJson("/api/auth/signup", {
      clubName,
      adminName,
      email,
      password,
      ...captcha,
    });
    setBusy(false);

    if (!res.ok) {
      // Any rejection burns the challenge, so fetch a fresh question.
      setCaptchaKey((n) => n + 1);
      if (res.code === "WEAK_PASSWORD") {
        setErrors({ password: res.message });
        return;
      }
      if (res.code === "VALIDATION") {
        const f = (res.data as { details?: { fieldErrors?: Record<string, string[]> } })?.details
          ?.fieldErrors;
        if (f) {
          setErrors(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v?.[0] ?? ""])));
          return;
        }
      }
      toast.error(res.message);
      return;
    }

    // Never signed in here: confirming the address is the abuse control, so
    // the next step is the code, not a dashboard.
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormField label="Club name" error={errors.clubName} required>
        {(p) => (
          <Input
            {...p}
            autoFocus
            value={clubName}
            onChange={(e) => setClubName(e.target.value)}
            placeholder="e.g. Silverline Riding Club"
          />
        )}
      </FormField>

      <FormField label="Your name" error={errors.adminName} required>
        {(p) => (
          <Input
            {...p}
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            placeholder="Full name"
          />
        )}
      </FormField>

      <FormField
        label="Work email"
        error={errors.email}
        hint="We'll send a code here to confirm it's yours."
        required
      >
        {(p) => (
          <Input
            {...p}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@club.in"
          />
        )}
      </FormField>

      <FormField
        label="Password"
        error={errors.password}
        hint="At least 8 characters, mixing letters, digits or symbols."
        required
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </FormField>

      <CaptchaField value={captcha} onChange={setCaptcha} disabled={busy} refreshKey={captchaKey} />

      <Button
        type="submit"
        className="w-full"
        disabled={busy || !clubName || !adminName || !email || !password}
      >
        {busy ? "Creating your club…" : "Start 14-day trial"}
      </Button>

      <p className="text-center text-[11px] text-muted-foreground">
        By continuing you agree to our{" "}
        <Link href="/terms" className="underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        .
      </p>
      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
