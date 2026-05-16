"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

export function RiderPortalPanel({
  riderId,
  currentUser,
}: {
  riderId: string;
  currentUser: { id: string; email: string } | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function issue() {
    if (!email.trim()) {
      toast.error("Email is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/riders/${riderId}/portal-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "EMAIL_TAKEN"
            ? "That email is already attached to another user"
            : data.error === "ALREADY_LINKED"
              ? "This rider already has portal access"
              : data.error ?? "Failed";
        toast.error(msg);
        return;
      }
      setTempPassword(data.tempPassword);
      setEmail("");
      toast.success("Portal access issued");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    const ok = await openConfirm({
      title: "Revoke rider portal login?",
      body: "Their account will be removed. You can re-invite them later.",
      destructive: true,
      confirmLabel: "Revoke access",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/riders/${riderId}/portal-access`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success("Access revoked");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {tempPassword && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
          <div className="font-semibold text-amber-900">Share these credentials with the rider</div>
          <div className="mt-1 font-mono text-xs text-amber-900">
            Password: <span className="font-bold">{tempPassword}</span>
          </div>
          <div className="mt-1 text-xs text-amber-800">
            Shown once. Ask the rider to change it after first sign-in.
          </div>
        </div>
      )}

      {currentUser ? (
        <div className="flex items-center justify-between rounded-md border p-2 text-sm">
          <div>
            <div className="font-medium">Linked: {currentUser.email}</div>
            <div className="text-xs text-muted-foreground">
              Rider can sign in at <code>/login</code> and lands on <code>/student</code>.
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={revoke}>
            Revoke
          </Button>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">
            Create a sign-in for this rider so they can view their attendance / skills / exam results.
          </div>
          <div>
            <Label htmlFor={`r-portal-${riderId}`}>Rider email</Label>
            <Input
              id={`r-portal-${riderId}`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rider@example.com"
            />
          </div>
          <Button size="sm" disabled={busy} onClick={issue}>
            {busy ? "Issuing…" : "Issue portal access"}
          </Button>
        </div>
      )}
    </div>
  );
}
