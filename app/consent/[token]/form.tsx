"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ConsentSignForm({
  token,
  isMinor,
  riderName,
}: {
  token: string;
  isMinor: boolean;
  riderName: string;
}) {
  const [signature, setSignature] = useState("");
  const [relation, setRelation] = useState<"self" | "parent" | "guardian">(
    isMinor ? "parent" : "self",
  );
  const [agreed, setAgreed] = useState(false);
  const [noc, setNoc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every condition for a valid signature, in one place — so the button can be
  // honest about why it is disabled instead of failing on submit. The
  // onboarding wizard's version of this shipped without it and bounced a
  // parent who had filled in five steps correctly.
  const missing = !signature.trim()
    ? "Type your full name to sign"
    : !agreed
      ? "Tick the indemnity box"
      : !noc
        ? "Tick the injury NOC box"
        : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (missing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/consent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullNameSignature: signature.trim(),
          agreed: true,
          injuryNocAgreed: true,
          signerRelation: relation,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-6 rounded-md border border-green-300 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/40">
        <h2 className="font-semibold">Signed — thank you</h2>
        <p className="mt-1 text-sm">
          The indemnity and NOC for {riderName} are now on file. The centre will confirm it at
          their end. You can close this page; there is nothing else to do.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span>I have read and agree to the indemnity and liability release above.</span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={noc}
          onChange={(e) => setNoc(e.target.checked)}
          className="mt-1"
        />
        <span>I give the No-Objection Consent for injuries as set out above.</span>
      </label>

      {isMinor && (
        <div className="space-y-1.5">
          <Label htmlFor="relation">I am signing as</Label>
          <select
            id="relation"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={relation}
            onChange={(e) => setRelation(e.target.value as typeof relation)}
          >
            <option value="parent">Parent</option>
            <option value="guardian">Legal guardian</option>
          </select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="signature">
          {isMinor ? "Your full name (the signing adult)" : "Your full name"}
        </Label>
        <Input
          id="signature"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder={isMinor ? "e.g. Priya Sharma" : riderName}
          autoComplete="name"
        />
        <p className="text-xs text-muted-foreground">
          Typing your name here is your electronic signature. It is recorded with the date, time
          and IP address as proof of consent.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={busy || Boolean(missing)} title={missing ?? undefined}>
        {busy ? "Signing…" : "Sign and submit"}
      </Button>
      {missing && <p className="text-xs text-muted-foreground">{missing}.</p>}
    </form>
  );
}
