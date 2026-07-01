"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { safeNextPath } from "@/lib/safe-redirect";
import { postJson } from "@/lib/client/post-json";

export function OwnerLoginForm({ next, devMode = false }: { next: string; devMode?: boolean }) {
  const router = useRouter();
  // Prefill ONLY in dev (parent passes `process.env.NODE_ENV !== "production"`).
  // Production builds never expose the local test credentials.
  const [email, setEmail] = useState(devMode ? "owner@platform.local" : "");
  const [password, setPassword] = useState(devMode ? "1234" : "");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const payload: Record<string, unknown> = { email, password };
    if (needTotp) {
      if (useRecovery) payload.recoveryCode = recoveryCode;
      else payload.totp = totp;
    }
    const res = await postJson<{ redirect?: string }>("/api/owner/auth/login", payload);
    setLoading(false);
    if (!res.ok) {
      if (res.code === "TOTP_REQUIRED") {
        setNeedTotp(true);
        return;
      }
      if (res.code === "TOTP_INVALID") {
        toast.error("Wrong code. Re-check your authenticator and try again.");
        return;
      }
      if (res.code === "TOTP_REPLAY") {
        toast.error("This code was already used. Wait for the next one in your app.");
        return;
      }
      if (res.code === "RECOVERY_INVALID") {
        toast.error("Recovery code not recognised — each is single-use.");
        return;
      }
      toast.error(res.message);
      return;
    }
    const requested = next !== "/owner" ? next : (res.data.redirect ?? "/owner");
    const target = safeNextPath(requested, res.data.redirect ?? "/owner");
    router.push(target);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="owner-email" className="text-slate-200">Email</Label>
        <Input
          id="owner-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            // Changing credentials invalidates the previous 2FA-required
            // state — otherwise a user who mistypes the password ends up
            // stuck in the TOTP step.
            if (needTotp) { setNeedTotp(false); setTotp(""); }
          }}
          required
          className="border-slate-700 bg-slate-950 text-slate-100"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="owner-password" className="text-slate-200">Password</Label>
        <Input
          id="owner-password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (needTotp) { setNeedTotp(false); setTotp(""); }
          }}
          required
          className="border-slate-700 bg-slate-950 text-slate-100"
        />
      </div>
      {needTotp && !useRecovery && (
        <div className="space-y-1.5">
          <Label htmlFor="owner-totp" className="text-slate-200">
            6-digit code from your authenticator app
          </Label>
          <Input
            id="owner-totp"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            autoFocus
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            placeholder="123456"
            className="border-slate-700 bg-slate-950 text-center font-mono text-lg tracking-widest text-slate-100"
          />
          <button
            type="button"
            onClick={() => { setUseRecovery(true); setTotp(""); }}
            className="text-[11px] text-slate-400 hover:text-slate-200 hover:underline"
          >
            Lost your authenticator? Use a recovery code →
          </button>
        </div>
      )}
      {needTotp && useRecovery && (
        <div className="space-y-1.5">
          <Label htmlFor="owner-recovery" className="text-slate-200">Recovery Code</Label>
          <Input
            id="owner-recovery"
            type="text"
            autoFocus
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            required
            placeholder="0123456789ab"
            className="border-slate-700 bg-slate-950 font-mono text-slate-100"
          />
          <button
            type="button"
            onClick={() => { setUseRecovery(false); setRecoveryCode(""); }}
            className="text-[11px] text-slate-400 hover:text-slate-200 hover:underline"
          >
            ← Back to authenticator code
          </button>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : needTotp ? "Verify & sign in" : "Sign in"}
      </Button>
    </form>
  );
}
