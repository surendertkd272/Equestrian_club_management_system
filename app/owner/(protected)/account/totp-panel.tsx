"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function OwnerTotpPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "enrolling" | "disabling" | "regenerating" | "show_recovery">("idle");
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setBusy(true);
    try {
      const res = await fetch("/api/owner/account/totp");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      setSecret(data.secret);
      setOtpauthUrl(data.otpauthUrl);
      setStage("enrolling");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    setBusy(true);
    try {
      const res = await fetch("/api/owner/account/totp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error === "BAD_CODE" ? "Wrong code, try again." : "Failed");
        return;
      }
      toast.success("2FA enabled.");
      // Stash the one-shot recovery codes so the user can copy them down
      // — they only appear here, once.
      setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes : []);
      setStage("show_recovery");
      setCode("");
      setSecret("");
      setOtpauthUrl("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function regenerateRecovery() {
    setBusy(true);
    try {
      const res = await fetch("/api/owner/account/totp/recovery-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error === "BAD_CODE" ? "Wrong code." : "Failed");
        return;
      }
      toast.success("New recovery codes issued.");
      setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes : []);
      setStage("show_recovery");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const res = await fetch("/api/owner/account/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error === "BAD_CODE" ? "Wrong code." : "Failed");
        return;
      }
      toast.success("2FA disabled.");
      setStage("idle");
      setCode("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-slate-800 bg-slate-900">
      <CardHeader>
        <CardTitle className="text-base">Two-factor authentication</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-200">
        {stage === "show_recovery" && recoveryCodes.length > 0 ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-700 bg-amber-900/30 p-3 text-xs text-amber-200">
              <strong>Save these recovery codes now.</strong> They appear only once. Each
              code can sign you in if you lose your authenticator, and is single-use.
            </div>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <li key={c} className="rounded border border-slate-700 bg-slate-950 px-2 py-1">{c}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => navigator.clipboard.writeText(recoveryCodes.join("\n"))}
                className="border-slate-700 text-slate-200"
              >
                Copy all
              </Button>
              <Button onClick={() => { setStage("idle"); setRecoveryCodes([]); }}>I've saved them</Button>
            </div>
          </div>
        ) : enabled ? (
          <>
            <div className="rounded-md border border-emerald-700 bg-emerald-900/30 px-3 py-2 text-xs text-emerald-200">
              2FA is <strong>on</strong>. You'll be asked for a code on every sign-in.
            </div>
            {stage !== "disabling" && stage !== "regenerating" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStage("regenerating")}
                  className="border-slate-700 text-slate-200"
                >
                  Regenerate recovery codes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStage("disabling")}
                  className="border-slate-700 text-slate-200"
                >
                  Disable 2FA
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="disable-code" className="text-slate-300">
                  {stage === "regenerating"
                    ? "Enter a current code to confirm — old recovery codes will stop working"
                    : "Enter a current code to confirm"}
                </Label>
                <Input
                  id="disable-code"
                  inputMode="numeric"
                  pattern="\d{6}"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="border-slate-700 bg-slate-950 font-mono text-slate-100"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => { setStage("idle"); setCode(""); }}
                    className="border-slate-700 text-slate-200"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={stage === "regenerating" ? regenerateRecovery : disable}
                    disabled={busy || code.length !== 6}
                  >
                    {stage === "regenerating" ? "Issue new codes" : "Disable"}
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : stage === "idle" ? (
          <>
            <p className="text-xs text-slate-400">
              Add a second factor (Google Authenticator, 1Password, Authy, etc.) so a stolen
              password alone can't sign in to the owner console.
            </p>
            <Button onClick={startEnroll} disabled={busy}>Set up 2FA</Button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              1. Open your authenticator app and tap "Add account → from setup key".
            </p>
            <div className="rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs">
              <div className="text-[10px] uppercase text-slate-500">Secret</div>
              <div className="break-all">{secret}</div>
              <div className="mt-2 text-[10px] uppercase text-slate-500">otpauth URL (paste if your app accepts it)</div>
              <div className="break-all text-slate-300">{otpauthUrl}</div>
            </div>
            <p className="text-xs text-slate-400">
              2. Enter the 6-digit code your app shows to confirm enrollment.
            </p>
            <Input
              inputMode="numeric"
              pattern="\d{6}"
              value={code}
              autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="border-slate-700 bg-slate-950 text-center font-mono text-lg tracking-widest text-slate-100"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => { setStage("idle"); setCode(""); }}
                className="border-slate-700 text-slate-200"
              >
                Cancel
              </Button>
              <Button onClick={confirmEnroll} disabled={busy || code.length !== 6}>
                Confirm & enable
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
