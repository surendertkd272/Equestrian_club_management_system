"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function RotateForm({ homeOnSuccess }: { homeOnSuccess: string }) {
  const router = useRouter();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [conf, setConf] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (next !== conf) {
      toast.error("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error === "BAD_CURRENT_PASSWORD"
          ? "The temporary password you typed is wrong."
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success("Password set — welcome!");
      router.push(homeOnSuccess);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="rot-cur">Current (temporary) password</Label>
        <Input id="rot-cur" type="password" autoFocus value={cur} onChange={(e) => setCur(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="rot-new">New Password</Label>
        <Input
          id="rot-new"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="8+ characters"
        />
      </div>
      <div>
        <Label htmlFor="rot-conf">Confirm New Password</Label>
        <Input id="rot-conf" type="password" value={conf} onChange={(e) => setConf(e.target.value)} />
      </div>
      <Button onClick={submit} disabled={!cur || !next || busy} className="w-full">
        {busy ? "Saving…" : "Set new password"}
      </Button>
    </div>
  );
}
