"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function OwnerResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw1.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (pw1 !== pw2) {
      toast.error("Confirmation doesn't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/owner/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: pw1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "INVALID_TOKEN" ? "This link is no longer valid. Request a new one."
          : data.error === "TOKEN_USED" ? "This link has already been used."
          : data.error === "TOKEN_EXPIRED" ? "This link has expired. Request a new one."
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-emerald-700 bg-emerald-900/30 p-3 text-sm text-emerald-200">
          <div className="font-semibold">Password updated.</div>
          <p className="mt-1 text-xs">Sign in with your new credentials.</p>
        </div>
        <Button className="w-full" onClick={() => router.push("/owner/login")}>
          Go to owner sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Label htmlFor="orp-1" className="text-slate-300">New password</Label>
        <Input
          id="orp-1"
          type="password"
          autoFocus
          required
          minLength={8}
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
          className="border-slate-700 bg-slate-950 text-slate-100"
        />
      </div>
      <div>
        <Label htmlFor="orp-2" className="text-slate-300">Confirm</Label>
        <Input
          id="orp-2"
          type="password"
          required
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          className="border-slate-700 bg-slate-950 text-slate-100"
        />
      </div>
      <Button type="submit" disabled={busy || !pw1} className="w-full">
        {busy ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
