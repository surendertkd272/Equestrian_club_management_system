"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { STAFF_INVITE_ROLES, STAFF_INVITE_ROLE_LABEL } from "@/lib/schemas/staff-invite";
import { formatDate } from "@/lib/utils";

type Invite = {
  code: string;
  email: string | null;
  role: string | null;
  used: boolean;
  expired: boolean;
  createdAt: string;
  expiresAt: string | null;
  lastRedeemedAt: string | null;
};

function inviteUrl(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/staff-register/${code}`;
}

export function StaffInviteManager({ invites }: { invites: Invite[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "COACH", expiresInDays: "14" });
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function generate() {
    // Email is optional now — when blank, we generate a single-use link
    // the admin can share manually (WhatsApp/SMS). When filled, the
    // invite is email-locked: only that exact email address can redeem.
    const email = form.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      toast.error("That's not a valid email — include a domain, e.g. name@example.com");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/staff-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email || undefined,
          name: form.name.trim() || undefined,
          role: form.role,
          expiresInDays: Number(form.expiresInDays) || 14,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.error === "EMAIL_IN_USE"
            ? "An account with this email already exists."
            : data.error === "VALIDATION"
              ? "Check the email and role — the email needs a full domain like name@example.com."
              : data.error ?? "Failed",
        );
        return;
      }
      const url = inviteUrl(data.code);
      setLastUrl(url);
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast.success("Invite link created + copied");
      setForm((f) => ({ ...f, email: "", name: "" }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function copy(code: string) {
    const url = inviteUrl(code);
    navigator.clipboard?.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Copy failed"),
    );
  }

  function shareWhatsApp(inv: Invite) {
    const url = inviteUrl(inv.code);
    const msg = `You've been invited to register as ${inv.role ? STAFF_INVITE_ROLE_LABEL[inv.role] ?? inv.role : "staff"}. Complete your registration here:\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  }

  const openCount = invites.filter((i) => !i.used && !i.expired).length;
  function statusOf(inv: Invite): { label: string; variant: "success" | "warning" | "outline" } {
    if (inv.used) return { label: "registered", variant: "success" };
    if (inv.expired) return { label: "expired", variant: "warning" };
    return { label: "open", variant: "outline" };
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invite new staff</CardTitle>
        <CardDescription>
          Generate a one-person, single-use registration link. Optionally lock to a specific email — leave email blank to make the link redeemable by anyone you share it with manually (WhatsApp/SMS).
          New hires fill their details, then land in the pending-approval queue (<a href="/users?status=pending_approval" className="underline">/users</a>) for you to activate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <Label>Email (optional)</Label>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="hire@example.com — or leave blank" />
          </div>
          <div>
            <Label>Name (optional)</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <Label>Role *</Label>
            <Select value={form.role} onChange={(e) => set("role", e.target.value)}>
              {STAFF_INVITE_ROLES.map((r) => (
                <option key={r} value={r}>{STAFF_INVITE_ROLE_LABEL[r] ?? r}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Expires in (days)</Label>
            <Input type="number" value={form.expiresInDays} onChange={(e) => set("expiresInDays", e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={generate} disabled={busy}>{busy ? "Generating…" : "Generate invite link"}</Button>
        </div>

        {lastUrl && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">New invite link (copied)</div>
            <div className="mt-1 break-all font-mono text-xs">{lastUrl}</div>
          </div>
        )}

        {invites.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Invite log — {invites.length} total · {openCount} open
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Invited email</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Sent</th>
                    <th className="px-3 py-2">Deadline</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => {
                    const st = statusOf(inv);
                    const isOpen = !inv.used && !inv.expired;
                    return (
                      <tr key={inv.code} className="border-t">
                        <td className="px-3 py-2 font-medium">{inv.email ?? "(any email)"}</td>
                        <td className="px-3 py-2">
                          {inv.role ? STAFF_INVITE_ROLE_LABEL[inv.role] ?? inv.role : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(new Date(inv.createdAt))}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {inv.expiresAt ? formatDate(new Date(inv.expiresAt)) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={st.variant}>{st.label}</Badge>
                          {inv.used && inv.lastRedeemedAt && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              {formatDate(new Date(inv.lastRedeemedAt))}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isOpen ? (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => copy(inv.code)}>Copy</Button>
                              <Button size="sm" variant="outline" onClick={() => shareWhatsApp(inv)}>WhatsApp</Button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
