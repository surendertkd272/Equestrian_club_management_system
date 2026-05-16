"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function ResetForm({ token }: { token: string }) {
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
      const res = await fetch("/api/auth/reset-password", {
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
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="font-semibold">Password updated.</div>
          <p className="mt-1 text-xs text-emerald-800">Sign in with your new credentials.</p>
        </div>
        <Button className="w-full" onClick={() => router.push("/login")}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Label htmlFor="rp-1">New password</Label>
        <Input
          id="rp-1"
          type="password"
          autoFocus
          required
          minLength={8}
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="rp-2">Confirm</Label>
        <Input
          id="rp-2"
          type="password"
          required
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy || !pw1} className="w-full">
        {busy ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
