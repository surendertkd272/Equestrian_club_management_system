"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION: "Enter your email and the 6-digit code.",
  INVALID_CODE: "That code is wrong. Double-check the email and try again.",
  CODE_EXPIRED: "This code has expired. Request a new one below.",
  CODE_USED: "This code was already used. Request a new one below.",
  TOO_MANY_ATTEMPTS: "Too many wrong attempts. Request a new code below.",
};

export function VerifyEmailForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERROR_MESSAGES[data.error] ?? "Something went wrong. Try again.");
        return;
      }
      setVerified(true);
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setResending(true);
    setError(null);
    try {
      // Always returns 200 — we never leak whether the email exists.
      await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResent(true);
      setCode("");
    } finally {
      setResending(false);
    }
  }

  if (verified) {
    return (
      <div className="rounded-md border border-success/30 bg-success-soft p-3 text-sm text-success-foreground">
        <div className="font-semibold">Email verified.</div>
        <p className="mt-1 text-xs text-success-foreground">
          You can <a href="/login" className="underline">sign in</a> now.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="ve-email">Email</Label>
        <Input
          id="ve-email"
          type="email"
          autoFocus={!email}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div>
        <Label htmlFor="ve-code">6-digit code</Label>
        <Input
          id="ve-code"
          inputMode="numeric"
          autoFocus={!!email}
          required
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
        />
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-soft p-2.5 text-xs text-danger-foreground">{error}</div>
      )}
      {resent && !error && (
        <div className="rounded-md border border-success/30 bg-success-soft p-2.5 text-xs text-success-foreground">
          If that email is on file, a new code is on its way.
        </div>
      )}

      <Button type="submit" disabled={busy || !email || code.length !== 6} className="w-full">
        {busy ? "Verifying…" : "Verify email"}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onResend}
        disabled={resending || !email}
        className="w-full"
      >
        {resending ? "Sending…" : "Resend code"}
      </Button>
    </form>
  );
}
