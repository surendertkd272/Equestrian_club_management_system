"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Centre = { id: string; name: string; slug: string };

// ─────────────────────────────────────────────────────────────────────────────

export function UserSearchBar({
  centres,
  roles,
  initial,
}: {
  centres: Centre[];
  roles: readonly string[];
  initial: { q: string; role: string; centreId: string; status: string };
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [role, setRole] = useState(initial.role);
  const [centreId, setCentreId] = useState(initial.centreId);
  const [status, setStatus] = useState(initial.status);

  function apply() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (role) params.set("role", role);
    if (centreId) params.set("centreId", centreId);
    if (status) params.set("status", status);
    router.push(`/users${params.toString() ? `?${params}` : ""}`);
  }

  function clear() {
    setQ("");
    setRole("");
    setCentreId("");
    setStatus("");
    router.push("/users");
  }

  return (
    <div className="grid gap-3 sm:grid-cols-5">
      <div className="sm:col-span-2">
        <Label htmlFor="u-q">Search</Label>
        <Input
          id="u-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or email"
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
        />
      </div>
      <div>
        <Label htmlFor="u-role">Role</Label>
        <select
          id="u-role"
          className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">Any</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="u-centre">Centre</Label>
        <select
          id="u-centre"
          className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={centreId}
          onChange={(e) => setCentreId(e.target.value)}
        >
          <option value="">Any</option>
          <option value="null">HQ (No Centre)</option>
          {centres.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="u-status">Status</Label>
        <select
          id="u-status"
          className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Any</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      <div className="sm:col-span-5 flex gap-2">
        <Button onClick={apply}>Apply</Button>
        <Button variant="outline" onClick={clear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type UserShape = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  centreId: string | null;
  status: string;
};

export function UserActions({
  user,
  centres,
  roles,
  isSelf,
  canResetPassword,
}: {
  user: UserShape;
  centres: Centre[];
  roles: readonly string[];
  isSelf: boolean;
  // Password reset is SUPER_ADMIN-only on the API. Hide the button for other
  // roles (e.g. ADMIN, who can edit/suspend/create but not reset) so we don't
  // show an action that just fails.
  canResetPassword: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    centreId: user.centreId ?? "",
    status: user.status,
  });
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const dirty =
    draft.name !== user.name ||
    draft.email !== user.email ||
    draft.phone !== user.phone ||
    draft.role !== user.role ||
    (draft.centreId || null) !== user.centreId ||
    draft.status !== user.status;

  async function save() {
    if (!dirty) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name !== user.name ? draft.name : undefined,
          email: draft.email !== user.email ? draft.email : undefined,
          phone: draft.phone !== user.phone ? draft.phone || null : undefined,
          role: draft.role !== user.role ? draft.role : undefined,
          centreId:
            (draft.centreId || null) !== user.centreId ? draft.centreId || null : undefined,
          status: draft.status !== user.status ? draft.status : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "LAST_SUPER_ADMIN"
            ? "Can't demote/suspend the last super admin"
            : data.error === "CANNOT_DEMOTE_SELF"
              ? "You can't demote or suspend yourself"
              : data.error === "EMAIL_TAKEN"
                ? "Email already in use by another user"
                : data.error === "CENTRE_NOT_FOUND"
                  ? "Centre not found"
                  : data.error ?? "Failed";
        toast.error(msg);
        return;
      }
      toast.success("Saved");
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resetPwd() {
    const ok = await openConfirm({
      title: `Generate new temporary password for ${user.name}?`,
      body: "The current password will stop working immediately. The new one is shown ONCE — share it via WhatsApp/email and ask them to rotate it after first login.",
      destructive: true,
      confirmLabel: "Reset password",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      setTempPassword(data.tempPassword);
      toast.success("Password reset");
    } finally {
      setBusy(false);
    }
  }

  if (tempPassword) {
    return (
      <div className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-2 text-left">
        <div className="text-[10px] font-semibold uppercase text-amber-900">
          Share this with {user.name}:
        </div>
        <div className="font-mono text-xs font-bold text-amber-900 break-all">{tempPassword}</div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setTempPassword(null);
            router.refresh();
          }}
        >
          Done
        </Button>
      </div>
    );
  }

  async function deleteUser() {
    if (isSelf) {
      toast.error("You can't delete yourself.");
      return;
    }
    const ok = await openConfirm({
      title: `Permanently delete ${user.name}?`,
      body: `${user.email} — this cannot be undone. Users with staff records, financial history, or rider/centre/parent links can't be deleted — suspend or offboard them instead.`,
      destructive: true,
      confirmLabel: "Delete user",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "LAST_SUPER_ADMIN" ? "Can't delete the last active super admin."
          : data.error === "CANNOT_DELETE_SELF" ? "You can't delete yourself."
          : data.error === "USER_LINKED_TO_RIDER" ? `Linked to rider ${data.details?.riderName} — revoke portal access first.`
          : data.error === "USER_IS_CENTRE_MANAGER" ? `Manager of ${data.details?.centreName} — reassign that centre's manager first.`
          : data.error === "USER_HAS_PARENT_LINKS" ? `Linked to ${data.details?.links} rider(s) as a parent — unlink first.`
          : data.error === "USER_HAS_RECORDS" ? `${user.name} has ${(data.details?.kinds ?? ["linked records"]).join(", ")} that must be kept — suspend or offboard them instead of deleting.`
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success("User deleted");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        {canResetPassword && (
          <Button size="sm" variant="outline" disabled={busy} onClick={resetPwd}>
            Reset password
          </Button>
        )}
        {!isSelf && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={deleteUser}
            className="border-rose-400 text-rose-700 hover:bg-rose-50"
          >
            Delete
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2 text-left">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`n-${user.id}`} className="text-xs">
            Name
          </Label>
          <Input
            id={`n-${user.id}`}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`e-${user.id}`} className="text-xs">
            Email
          </Label>
          <Input
            id={`e-${user.id}`}
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`p-${user.id}`} className="text-xs">
            Phone
          </Label>
          <Input
            id={`p-${user.id}`}
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`r-${user.id}`} className="text-xs">
            Role
          </Label>
          <select
            id={`r-${user.id}`}
            className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value })}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`c-${user.id}`} className="text-xs">
            Centre
          </Label>
          <select
            id={`c-${user.id}`}
            className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={draft.centreId}
            onChange={(e) => setDraft({ ...draft, centreId: e.target.value })}
          >
            <option value="">HQ (no centre)</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`s-${user.id}`} className="text-xs">
            Status
          </Label>
          <select
            id={`s-${user.id}`}
            className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            disabled={isSelf}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          {isSelf && (
            <p className="mt-1 text-[10px] text-muted-foreground">Can't suspend yourself.</p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft({
              name: user.name,
              email: user.email,
              phone: user.phone,
              role: user.role,
              centreId: user.centreId ?? "",
              status: user.status,
            });
            setEditing(false);
          }}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New-user card — sits at the top of /(admin)/users. Server generates the
// temp password and returns it ONCE; we render it in an amber box for the HQ
// admin to copy/paste to the new user via WhatsApp/email.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function NewUserCard({
  centres,
  roles,
}: {
  centres: Centre[];
  roles: readonly string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "COACH",
    centreId: "",
  });
  const [created, setCreated] = useState<{
    email: string;
    name: string;
    tempPassword: string;
  } | null>(null);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (form.name.trim().length < 2) return toast.error("Name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return toast.error("Valid email required.");
    setBusy(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          role: form.role,
          centreId: form.centreId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "EMAIL_TAKEN" ? "Email already in use."
          : data.error === "CENTRE_NOT_FOUND" ? "Centre not found."
          : (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      setCreated({ email: data.email, name: data.name, tempPassword: data.tempPassword });
      setForm({ name: "", email: "", phone: "", role: "COACH", centreId: "" });
      toast.success("User created");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Share These Credentials</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
              Send to {created.name}
            </div>
            <div className="space-y-1 font-mono text-xs text-amber-900">
              <div>
                <span className="text-amber-700">Email:</span>{" "}
                <code className="rounded bg-amber-100 px-1.5 py-0.5">{created.email}</code>
              </div>
              <div>
                <span className="text-amber-700">Temp password:</span>{" "}
                <code className="rounded bg-amber-100 px-1.5 py-0.5 font-bold">{created.tempPassword}</code>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(created.tempPassword);
                    toast.success("Copied");
                  }}
                  className="ml-2 rounded border border-amber-400 px-2 py-0.5 text-[10px] text-amber-900 hover:bg-amber-100"
                >
                  Copy
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-amber-800">
              Shown once. The user signs in at <code>/login</code> and should rotate it after
              first login.
            </p>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => setCreated(null)}>
              Add another user
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setCreated(null); setOpen(false); }}>
              Done
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>+ New user</Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New User</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="nu-name">Full Name *</Label>
            <Input id="nu-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="nu-email">Email *</Label>
            <Input id="nu-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="nu-phone">Phone</Label>
            <Input id="nu-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 …" />
          </div>
          <div>
            <Label htmlFor="nu-role">Role *</Label>
            <select
              id="nu-role"
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.role}
              onChange={(e) => set("role", e.target.value)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>{r.replaceAll("_", " ")}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="nu-centre">Centre</Label>
            <select
              id="nu-centre"
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.centreId}
              onChange={(e) => set("centreId", e.target.value)}
            >
              <option value="">HQ (no centre)</option>
              {centres.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Leave on "HQ" for super-admin / org-wide roles. Pick a centre for coaches, staff, etc.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create user"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setForm({ name: "", email: "", phone: "", role: "COACH", centreId: "" });
              setOpen(false);
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
