"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OwnerForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/owner/auth/forgot-password", {
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
      <div className="rounded-md border border-emerald-700 bg-emerald-900/30 p-3 text-sm text-emerald-200">
        <div className="font-semibold">Check your email.</div>
        <p className="mt-1 text-xs">
          If <code className="font-mono">{email}</code> is an owner account, a reset link is on
          its way. It expires in 30 minutes.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="ofp-email" className="text-slate-300">Email</Label>
        <Input
          id="ofp-email"
          type="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@platform.local"
          className="border-slate-700 bg-slate-950 text-slate-100"
        />
      </div>
      <Button type="submit" disabled={busy || !email} className="w-full">
        {busy ? "Sending…" : "Email me a reset link"}
      </Button>
    </form>
  );
}
