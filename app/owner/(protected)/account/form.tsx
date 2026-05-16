"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function OwnerAccountForm({
  initial,
}: {
  initial: { name: string; email: string; role: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [savingProfile, setSavingProfile] = useState(false);

  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [conf, setConf] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  async function saveProfile() {
    if (name === initial.name) return;
    setSavingProfile(true);
    try {
      const res = await fetch("/api/owner/account/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success("Saved");
      router.refresh();
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (next !== conf) {
      toast.error("Confirmation doesn't match.");
      return;
    }
    setSavingPwd(true);
    try {
      const res = await fetch("/api/owner/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "BAD_CURRENT_PASSWORD" ? "Current password is wrong."
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success("Password changed");
      setCur(""); setNext(""); setConf("");
    } finally {
      setSavingPwd(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Profile</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="o-name" className="text-slate-300">Name</Label>
            <Input
              id="o-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-slate-700 bg-slate-950 text-slate-100"
            />
          </div>
          <div>
            <Label className="text-slate-300">Email</Label>
            <Input value={initial.email} disabled className="border-slate-700 bg-slate-900 text-slate-400" />
          </div>
          <div>
            <Label className="text-slate-300">Role</Label>
            <Input value={initial.role} disabled className="border-slate-700 bg-slate-900 text-slate-400" />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={saveProfile} disabled={name === initial.name || savingProfile}>
            {savingProfile ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Change password</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="o-cur" className="text-slate-300">Current</Label>
            <Input id="o-cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} className="border-slate-700 bg-slate-950 text-slate-100" />
          </div>
          <div>
            <Label htmlFor="o-next" className="text-slate-300">New</Label>
            <Input id="o-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} className="border-slate-700 bg-slate-950 text-slate-100" />
          </div>
          <div>
            <Label htmlFor="o-conf" className="text-slate-300">Confirm</Label>
            <Input id="o-conf" type="password" value={conf} onChange={(e) => setConf(e.target.value)} className="border-slate-700 bg-slate-950 text-slate-100" />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={changePassword} disabled={!cur || !next || savingPwd}>
            {savingPwd ? "Updating…" : "Change password"}
          </Button>
        </div>
      </div>
    </div>
  );
}
