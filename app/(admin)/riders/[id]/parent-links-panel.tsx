"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Link = {
  id: string;
  relationship: string;
  name: string;
  email: string;
  phone: string | null;
};

export function ParentLinksPanel({ riderId, links }: { riderId: string; links: Link[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState<"father" | "mother" | "guardian">("father");
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !email.trim()) {
      toast.error("Name and email required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/riders/${riderId}/parent-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relationship,
          parent: { name, email, phone: phone || undefined },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Linked");
      if (data.tempPassword) {
        // Show once — parent will need it to first sign in.
        setTempPassword(data.tempPassword);
      }
      setName("");
      setEmail("");
      setPhone("");
      setShowForm(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function unlink(linkId: string) {
    const ok = await openConfirm({
      title: "Remove this parent's portal access?",
      destructive: true,
      confirmLabel: "Remove access",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/riders/${riderId}/parent-links/${linkId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Unlinked");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {tempPassword && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
          <div className="font-semibold text-amber-900">Share these credentials with the parent</div>
          <div className="mt-1 font-mono text-xs text-amber-900">
            Password: <span className="font-bold">{tempPassword}</span>
          </div>
          <div className="mt-1 text-xs text-amber-800">
            This password is shown once. Ask the parent to change it after first sign-in.
          </div>
        </div>
      )}

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No parents linked yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between rounded-md border p-2">
              <div>
                <div className="font-medium">
                  {l.name} <Badge variant="outline">{l.relationship}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {l.email}
                  {l.phone && ` · ${l.phone}`}
                </div>
              </div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => unlink(l.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="pl-name">Name</Label>
              <Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pl-email">Email</Label>
              <Input id="pl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pl-phone">Phone</Label>
              <Input id="pl-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pl-rel">Relationship</Label>
              <select
                id="pl-rel"
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value as any)}
              >
                <option value="father">father</option>
                <option value="mother">mother</option>
                <option value="guardian">guardian</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={submit}>
              {busy ? "Linking…" : "Link parent"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
          Add parent
        </Button>
      )}
    </div>
  );
}
