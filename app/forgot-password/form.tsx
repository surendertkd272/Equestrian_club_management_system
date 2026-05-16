"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // Always returns 200 — we never leak whether the email exists.
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <div className="font-semibold">Check your email.</div>
        <p className="mt-1 text-xs text-emerald-800">
          If <code className="font-mono">{email}</code> is on file, a reset link is on its
          way. It expires in 30 minutes.
        </p>
        <p className="mt-2 text-xs text-emerald-800">
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
      <Button type="submit" disabled={busy || !email} className="w-full">
        {busy ? "Sending…" : "Email me a reset link"}
      </Button>
    </form>
  );
}
