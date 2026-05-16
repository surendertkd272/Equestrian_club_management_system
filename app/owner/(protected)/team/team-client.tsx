"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type OwnerRoleKey = "OWNER_ADMIN" | "OWNER_EDITOR" | "OWNER_BILLING";

type Row = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
};

const ROLE_LABEL: Record<string, string> = {
  OWNER_ADMIN: "Admin",
  OWNER_EDITOR: "Editor",
  OWNER_BILLING: "Billing",
};

export function TeamClient({
  initial,
  canManage,
  currentUserId,
}: {
  initial: Row[];
  canManage: boolean;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ email: string; tempPassword: string } | null>(null);

  async function patch(id: string, payload: Partial<{ role: OwnerRoleKey; status: "active" | "suspended"; name: string }>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/owner/team/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "LAST_OWNER_ADMIN" ? "Can't demote/suspend the last active Admin."
          : data.error === "CANNOT_DEMOTE_SELF" ? "You can't demote or suspend yourself."
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success("Saved");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {canManage && <InviteCard onInvited={(x) => { setInvited(x); router.refresh(); }} />}

      {invited && (
        <div className="rounded-md border border-amber-700 bg-amber-950/30 p-4 text-sm">
          <div className="font-semibold text-amber-300">Temp password for {invited.email}</div>
          <div className="mt-1 font-mono text-amber-100">
            <code className="rounded bg-amber-950 px-1.5 py-0.5">{invited.tempPassword}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(invited.tempPassword);
                toast.success("Copied");
              }}
              className="ml-2 rounded border border-amber-700 px-2 py-0.5 text-xs text-amber-200 hover:bg-amber-900"
            >
              Copy
            </button>
          </div>
          <div className="mt-2 text-xs text-amber-300/80">
            Shown once. Share it with them via a secure channel; ask them to rotate after first sign-in.
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Joined</th>
            </tr>
          </thead>
          <tbody>
            {initial.map((u) => {
              const isSelf = u.id === currentUserId;
              const disabled = !canManage || busyId === u.id;
              return (
                <tr key={u.id} className="border-t border-slate-800 hover:bg-slate-900/40">
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-slate-100">{u.name}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                    {isSelf && <div className="mt-0.5 text-[10px] uppercase tracking-wide text-emerald-400">You</div>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {canManage ? (
                      <select
                        value={u.role}
                        onChange={(e) => patch(u.id, { role: e.target.value as OwnerRoleKey })}
                        disabled={disabled || isSelf}
                        className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 disabled:opacity-60"
                      >
                        <option value="OWNER_ADMIN">Admin</option>
                        <option value="OWNER_EDITOR">Editor</option>
                        <option value="OWNER_BILLING">Billing</option>
                      </select>
                    ) : (
                      <span className="text-slate-300">{ROLE_LABEL[u.role] ?? u.role}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => patch(u.id, { status: u.status === "active" ? "suspended" : "active" })}
                        disabled={disabled || isSelf}
                        className={`rounded px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                          u.status === "active"
                            ? "bg-emerald-500/20 text-emerald-300 hover:brightness-110"
                            : "bg-rose-500/20 text-rose-300 hover:brightness-110"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {u.status}
                      </button>
                    ) : (
                      <span className="text-slate-300">{u.status}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-slate-400">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!canManage && (
        <p className="text-xs text-slate-500">
          You can see the team but not edit it. Only an OWNER_ADMIN can invite or change roles.
        </p>
      )}
    </div>
  );
}

function InviteCard({ onInvited }: { onInvited: (x: { email: string; tempPassword: string }) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OwnerRoleKey>("OWNER_EDITOR");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("Name + a valid email please.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/owner/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error === "EMAIL_TAKEN" ? "Email already in use." : (data.error ?? "Failed"));
        return;
      }
      toast.success(`${email.trim()} invited`);
      onInvited({ email: data.email, tempPassword: data.tempPassword });
      setName("");
      setEmail("");
      setRole("OWNER_EDITOR");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Invite team member
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="inv-name" className="text-slate-300">Name</Label>
          <Input
            id="inv-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-slate-700 bg-slate-950 text-slate-100"
          />
        </div>
        <div>
          <Label htmlFor="inv-email" className="text-slate-300">Email</Label>
          <Input
            id="inv-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-slate-700 bg-slate-950 text-slate-100"
          />
        </div>
        <div>
          <Label htmlFor="inv-role" className="text-slate-300">Role</Label>
          <select
            id="inv-role"
            value={role}
            onChange={(e) => setRole(e.target.value as OwnerRoleKey)}
            className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
          >
            <option value="OWNER_ADMIN">Admin (full)</option>
            <option value="OWNER_EDITOR">Editor (rename / contact)</option>
            <option value="OWNER_BILLING">Billing (status / billing email)</option>
          </select>
        </div>
        <div className="flex items-end">
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? "Inviting…" : "Invite"}
          </Button>
        </div>
      </div>
    </div>
  );
}
