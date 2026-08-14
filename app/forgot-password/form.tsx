"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CaptchaField, EMPTY_CAPTCHA, type CaptchaValue } from "@/components/captcha-field";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  // The route hard-requires a solved challenge in production. This form never
  // sent one, so every production reset request hit the early return and no
  // email was ever sent — while the UI cheerfully said one was on its way.
  const [captcha, setCaptcha] = useState<CaptchaValue>(EMPTY_CAPTCHA);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // Always returns 200 — we never leak whether the email exists.
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...captcha }),
      });
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-md border border-success/30 bg-success-soft p-3 text-sm text-success-foreground">
        <div className="font-semibold">Check your email.</div>
        <p className="mt-1 text-xs text-success-foreground">
          If <code className="font-mono">{email}</code> is on file, a reset link is on its
          way. It expires in 30 minutes.
        </p>
        <p className="mt-2 text-xs text-success-foreground">
          Didn't get anything? Check spam, or ask your club admin to reset for you.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="fp-email">Email</Label>
        <Input
          id="fp-email"
          type="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <CaptchaField value={captcha} onChange={setCaptcha} disabled={busy} />
      <Button
        type="submit"
        disabled={busy || !email || !captcha.captchaToken || !captcha.captchaAnswer}
        className="w-full"
      >
        {busy ? "Sending…" : "Email me a reset link"}
      </Button>
    </form>
  );
}
