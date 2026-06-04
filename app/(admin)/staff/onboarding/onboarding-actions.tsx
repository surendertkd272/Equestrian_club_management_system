"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircle, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const roleLabel = (r: string) => r.replaceAll("_", " ").toLowerCase();

// Re-share an already-generated, still-active link (Copy + WhatsApp). Uses the
// stored plaintext token to rebuild the URL — survives page refreshes, unlike
// the one-shot panel shown right after generating.
export function LinkShareButtons({ token, note }: { token: string; note?: string | null }) {
  const url = () => `${typeof window !== "undefined" ? window.location.origin : ""}/onboard/staff/${token}`;
  return (
    <div className="mt-1 flex gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[11px]"
        onClick={() => {
          navigator.clipboard?.writeText(url());
          toast.success("Link copied — share it with the employee");
        }}
      >
        <Copy className="mr-1 h-3 w-3" /> Copy
      </Button>
      <Button
        size="sm"
        className="h-7 px-2 text-[11px]"
        onClick={() => {
          const msg = encodeURIComponent(
            `${note?.trim() ? note.trim() + " — " : ""}Please complete your Equiwings employee registration here:\n${url()}`,
          );
          window.open(`https://wa.me/?text=${msg}`, "_blank", "noopener,noreferrer");
        }}
      >
        <MessageCircle className="mr-1 h-3 w-3" /> WhatsApp
      </Button>
    </div>
  );
}

// Generate a shareable self-registration link — with an optional pre-set role
// (pre-fills the approval step) and a chosen link expiry.
export function GenerateLinkButton({ roles }: { roles: string[] }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [role, setRole] = useState(""); // "" → decide at approval
  const [expiresDays, setExpiresDays] = useState("14");
  const [note, setNote] = useState("");

  async function gen() {
    setBusy(true);
    try {
      const res = await fetch("/api/staff-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: role || undefined,
          expiresDays: Number(expiresDays) || 14,
          note: note.trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Failed");
        return;
      }
      setLink(d.link);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Candidate name (optional)</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For your reference" className="h-9" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Role</label>
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="h-9">
            <option value="">Decide at approval</option>
            {roles.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Link expires in</label>
          <Select value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} className="h-9">
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
          </Select>
        </div>
      </div>

      <Button onClick={gen} disabled={busy}>{busy ? "Generating…" : "Generate registration link"}</Button>

      {link && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 bg-transparent font-mono outline-none"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard?.writeText(link);
              toast.success("Link copied — share it with the employee");
            }}
          >
            <Copy className="mr-1 h-3 w-3" /> Copy
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const msg = encodeURIComponent(
                `${note.trim() ? note.trim() + " — " : ""}Please complete your Equiwings employee registration here:\n${link}`,
              );
              window.open(`https://wa.me/?text=${msg}`, "_blank", "noopener,noreferrer");
            }}
          >
            <MessageCircle className="mr-1 h-3 w-3" /> WhatsApp
          </Button>
        </div>
      )}
      {link && (
        <p className="text-[11px] text-muted-foreground">
          Share this with the employee. It expires in {expiresDays} day{expiresDays === "1" ? "" : "s"} and can be filled once.
          {role ? ` Pre-set role: ${roleLabel(role)} (you can still change it at approval).` : ""}
        </p>
      )}
    </div>
  );
}

// Approve a submitted onboarding → create the staff member with a chosen role.
// defaultRole comes from the role the admin pre-set when generating the link.
export function ApproveControl({ id, roles, defaultRole }: { id: string; roles: string[]; defaultRole?: string | null }) {
  const router = useRouter();
  const [role, setRole] = useState(
    defaultRole && roles.includes(defaultRole) ? defaultRole : roles.includes("COACH") ? "COACH" : roles[0],
  );
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      const res = await fetch(`/api/staff-onboarding/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error === "EMAIL_TAKEN" ? `Email already in use: ${d.email}` : (d.error ?? "Failed"));
        return;
      }
      toast.success(`Staff created. Temporary password: ${d.tempPassword}`, { duration: 30000 });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={role} onChange={(e) => setRole(e.target.value)} className="h-8 w-44 text-xs">
        {roles.map((r) => (
          <option key={r} value={r}>{r.replaceAll("_", " ").toLowerCase()}</option>
        ))}
      </Select>
      <Button size="sm" onClick={approve} disabled={busy}>{busy ? "Approving…" : "Approve & create staff"}</Button>
    </div>
  );
}

// Reject a submitted onboarding (with an optional reason). No staff is created;
// the row moves to "rejected" in the All-links list.
export function RejectControl({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const danger = "text-destructive hover:bg-destructive/10 hover:text-destructive";

  async function reject() {
    setBusy(true);
    try {
      const res = await fetch(`/api/staff-onboarding/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Failed to reject");
        return;
      }
      toast.success("Submission rejected");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className={danger} onClick={() => setOpen(true)}>
        Reject
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        className="h-8 w-40 text-xs"
      />
      <Button size="sm" variant="outline" className={danger} disabled={busy} onClick={reject}>
        {busy ? "Rejecting…" : "Confirm reject"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

// Waive pending onboarding items (specific keys or all remaining) for a hire.
export function WaiveControl({ id, pending }: { id: string; pending: { key: string; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function waive(payload: { items?: string[]; all?: boolean }, tag: string) {
    setBusy(tag);
    try {
      const res = await fetch(`/api/staff-onboarding/${id}/waive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast.error("Failed to waive");
        return;
      }
      toast.success("Waived");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {pending.map((p) => (
          <button
            key={p.key}
            type="button"
            disabled={busy !== null}
            onClick={() => waive({ items: [p.key] }, p.key)}
            className="rounded-full border bg-card px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
            title="Waive this requirement"
          >
            {p.label} <span className="text-muted-foreground">✕ waive</span>
          </button>
        ))}
      </div>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => waive({ all: true }, "all")}>
        {busy === "all" ? "Waiving…" : "Waive all remaining"}
      </Button>
    </div>
  );
}
