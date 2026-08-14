"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { safeNextPath } from "@/lib/safe-redirect";
import { postJson } from "@/lib/client/post-json";

// Seeded test accounts shown as quick-pick chips during development so a
// reviewer can switch between roles without remembering each email. The
// dropdown only renders when `quickPickEnabled` is true — the parent page
// passes that flag based on NODE_ENV so production never exposes it.
// Demo accounts live on the GHRC Equiwings centre (slug "ghrc") — the club
// used for UAT. All passwords are "password". The parent/student logins are
// wired to a dedicated "Demo Rider (Test)" so no real rider's data is exposed.
const QUICK_PICK: { label: string; email: string }[] = [
  { label: "HQ Super Admin", email: "super@equiwings.in" },
  { label: "HQ Admin", email: "admin@equiwings.in" },
  { label: "Centre Manager (GHRC)", email: "manager.ghrc@equiwings.in" },
  { label: "Head Coach (GHRC)", email: "headcoach.ghrc@equiwings.in" },
  { label: "Coach (GHRC)", email: "coach.ghrc@equiwings.in" },
  { label: "Examiner (GHRC)", email: "examiner.ghrc@equiwings.in" },
  { label: "Vet (GHRC)", email: "vet.ghrc@equiwings.in" },
  { label: "Inventory Mgr (GHRC)", email: "inventorymanager.ghrc@equiwings.in" },
  { label: "Stable Mgr (GHRC)", email: "stablemanager.ghrc@equiwings.in" },
  { label: "Accountant (GHRC)", email: "accountant.ghrc@equiwings.in" },
  { label: "School Administrator (GHRC)", email: "schooladmin.ghrc@equiwings.in" },
  { label: "Inspection Officer (GHRC)", email: "inspector.ghrc@equiwings.in" },
  { label: "Parent (GHRC)", email: "parent.ghrc@equiwings.in" },
  { label: "Student / Rider (GHRC)", email: "student.ghrc@equiwings.in" },
];

function formatDeletionDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

export function LoginForm({
  next,
  quickPickEnabled,
}: {
  next: string;
  // Server passes process.env.NODE_ENV !== "production" so the picker can't
  // leak into a live deploy.
  quickPickEnabled?: boolean;
}) {
  const router = useRouter();
  // Defaults prefilled for dev / UAT convenience. Seed.ts hashes every
  // seeded account with the password "password"; the reset-all-passwords
  // script can re-stamp them all back to the same value if they drift.
  const [email, setEmail] = useState(quickPickEnabled ? "super@equiwings.in" : "");
  const [password, setPassword] = useState(quickPickEnabled ? "password" : "");
  const [loading, setLoading] = useState(false);

  // Passwordless email-OTP sign-in (for users who forgot their password).
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [otpStage, setOtpStage] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  // Second factor. Shared by BOTH sign-in modes: the API applies the same 2FA
  // gate to each (lib/sign-in.ts), so the form has to be able to answer the
  // challenge on either path. Password mode previously had no field at all,
  // which meant enrolling in 2FA locked you out of password login entirely.
  const [needTotp, setNeedTotp] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  // Set when the API refuses the sign-in because the account is inside its
  // DPDPA deletion grace window. Holds the ISO date it's due to be erased.
  const [pendingDeletion, setPendingDeletion] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Shared post-auth navigation (password + OTP paths land here on success).
  function goAfterAuth(redirect?: string) {
    const requested = next !== "/dashboard" ? next : (redirect ?? "/dashboard");
    router.push(safeNextPath(requested, redirect ?? "/dashboard"));
    router.refresh();
  }

  function secondFactor(): { totpCode?: string; recoveryCode?: string } {
    if (!needTotp) return {};
    if (useRecovery) return recoveryCode.trim() ? { recoveryCode: recoveryCode.trim() } : {};
    return totpCode ? { totpCode } : {};
  }

  function resetSecondFactor() {
    setNeedTotp(false);
    setTotpCode("");
    setRecoveryCode("");
    setUseRecovery(false);
  }

  // Both sign-in endpoints return the same set of blocking codes. Handling
  // them in one place keeps the two modes from drifting — the same reason
  // lib/sign-in.ts centralises the server side. Returns true when handled.
  function handleBlocked(res: { code?: string; message: string; data: unknown }): boolean {
    if (res.code === "TWO_FACTOR_REQUIRED") {
      setNeedTotp(true);
      toast.message("Enter your authenticator code to finish signing in.");
      return true;
    }
    if (res.code === "TWO_FACTOR_INVALID" || res.code === "TWO_FACTOR_REPLAY") {
      setNeedTotp(true);
      setTotpCode("");
      setRecoveryCode("");
      toast.error(res.message);
      return true;
    }
    if (res.code === "DELETION_PENDING") {
      const scheduledFor = (res.data as { scheduledFor?: string })?.scheduledFor;
      setPendingDeletion(scheduledFor ?? "");
      return true;
    }
    if (res.code === "EMAIL_UNVERIFIED") {
      // The account exists and the password was right — it just never proved
      // the address. Send them to the page that takes the emailed code.
      toast.message("Confirm your email address to finish setting up.");
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
      return true;
    }
    if (res.code === "ACCOUNT_SUSPENDED") {
      toast.error(res.message, { duration: 10_000 });
      return true;
    }
    return false;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await postJson<{ redirect?: string }>("/api/auth/login", {
      email,
      password,
      ...secondFactor(),
    });
    setLoading(false);
    if (!res.ok) {
      if (!handleBlocked(res)) toast.error(res.message);
      return;
    }
    goAfterAuth(res.data.redirect);
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    await postJson("/api/auth/otp/request", { email });
    setBusy(false);
    setOtpStage("code");
    toast.success("If that email is registered, a 6-digit code is on its way.");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await postJson<{ redirect?: string }>("/api/auth/otp/verify", {
      email,
      code,
      ...secondFactor(),
    });
    setBusy(false);
    if (!res.ok) {
      if (!handleBlocked(res)) toast.error(res.message);
      return;
    }
    goAfterAuth(res.data.redirect);
  }

  // Withdraw a pending deletion. The account can't hold a session while the
  // flag is set, so this re-proves the credentials the user just supplied
  // rather than relying on a cookie.
  async function cancelDeletion() {
    const hadSecondFactor = needTotp;
    setCancelling(true);
    const res = await postJson("/api/auth/cancel-deletion", {
      email,
      ...(mode === "otp" ? { code } : { password }),
      ...secondFactor(),
    });
    setCancelling(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setPendingDeletion(null);

    // Straight back in when nothing single-use was spent proving it. With a
    // second factor in play we can't safely replay the credential (a recovery
    // code is consumed, and TOTP replay protection may land later), and the
    // OTP path's emailed code was consumed by the cancel itself.
    if (mode === "password" && !hadSecondFactor) {
      const login = await postJson<{ redirect?: string }>("/api/auth/login", { email, password });
      if (login.ok) {
        toast.success("Deletion cancelled — welcome back.");
        goAfterAuth(login.data.redirect);
        return;
      }
      toast.error(login.message);
      return;
    }
    resetSecondFactor();
    if (mode === "otp") {
      setOtpStage("email");
      setCode("");
    }
    toast.success("Deletion cancelled — your account is safe. Please sign in again.");
  }

  const secondFactorFields = needTotp ? (
    <div className="space-y-1.5">
      {useRecovery ? (
        <>
          <Label htmlFor="recovery-code">Recovery code</Label>
          <Input
            id="recovery-code"
            autoFocus
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="One of the codes you saved at setup"
          />
        </>
      ) : (
        <>
          <Label htmlFor="totp-code">Authenticator code</Label>
          <Input
            id="totp-code"
            inputMode="numeric"
            autoFocus
            maxLength={6}
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit code from your app"
          />
        </>
      )}
      <button
        type="button"
        onClick={() => {
          setUseRecovery(!useRecovery);
          setTotpCode("");
          setRecoveryCode("");
        }}
        className="text-[11px] text-muted-foreground hover:underline"
      >
        {useRecovery
          ? "Use my authenticator app instead"
          : "Lost your authenticator? Use a recovery code"}
      </button>
    </div>
  ) : null;

  // ── Pending-deletion interstitial ──────────────────────────────────────────
  // Credentials were correct, but the account is mid-erasure. This is the only
  // place the grace window can be withdrawn from — a signed-in Account Settings
  // page is unreachable, because a pending deletion nulls the session.
  if (pendingDeletion !== null) {
    const when = pendingDeletion ? formatDeletionDate(pendingDeletion) : null;
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-xs text-danger-foreground">
          <div className="font-semibold">This account is scheduled for deletion</div>
          <p className="mt-1">
            {when
              ? `Everything in it is due to be permanently erased on ${when}.`
              : "Everything in it is due to be permanently erased when the grace window closes."}{" "}
            You can stop that now and keep the account — you&apos;ll sign in as normal afterwards.
          </p>
        </div>
        <Button className="w-full" onClick={cancelDeletion} disabled={cancelling}>
          {cancelling ? "Cancelling…" : "Keep my account"}
        </Button>
        <div className="text-center text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setPendingDeletion(null)}
            className="hover:underline"
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // ── OTP (passwordless) mode ────────────────────────────────────────────────
  if (mode === "otp") {
    return (
      <form onSubmit={otpStage === "email" ? sendCode : verifyCode} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="otp-email">Email</Label>
          <Input
            id="otp-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={otpStage === "code"}
            placeholder="you@example.com"
          />
        </div>

        {otpStage === "email" ? (
          <>
            <Button type="submit" className="w-full" disabled={busy || !email}>
              {busy ? "Sending…" : "Email me a sign-in code"}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              We&apos;ll email a 6-digit code. No password needed.
            </p>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="otp-code">6-digit code</Label>
              <Input
                id="otp-code"
                inputMode="numeric"
                autoFocus
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
              />
              <button type="button" onClick={sendCode} className="text-[11px] text-muted-foreground hover:underline">
                Didn&apos;t get it? Resend code
              </button>
            </div>
            {secondFactorFields}
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </>
        )}

        <div className="text-center text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setOtpStage("email");
              setCode("");
              resetSecondFactor();
            }}
            className="hover:underline"
          >
            ← Sign in with password
          </button>
        </div>
      </form>
    );
  }

  // ── Password mode ───────────────────────────────────────────────────────────
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {quickPickEnabled && (
        <div className="rounded-md border border-warning/30 bg-warning-soft p-2 text-xs">
          <div className="mb-1 font-semibold text-warning-foreground">Dev quick-pick — local testing only</div>
          <select
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setPassword("password");
            }}
            className="h-8 w-full rounded border bg-card px-2 text-xs"
          >
            {QUICK_PICK.map((q) => (
              <option key={q.email} value={q.email}>
                {q.label} — {q.email}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs text-muted-foreground hover:underline">
            Forgot?
          </Link>
        </div>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {secondFactorFields}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>
      <div className="text-center text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => {
            setMode("otp");
            resetSecondFactor();
          }}
          className="hover:underline"
        >
          Forgot password? Sign in with an email code
        </button>
      </div>
    </form>
  );
}
