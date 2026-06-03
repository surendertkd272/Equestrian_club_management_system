"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

// Generate a shareable self-registration link and show it to copy.
export function GenerateLinkButton() {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  async function gen() {
    setBusy(true);
    try {
      const res = await fetch("/api/staff-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
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
    <div className="space-y-2">
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
            Copy
          </Button>
        </div>
      )}
      {link && (
        <p className="text-[11px] text-muted-foreground">Share this with the employee. It expires in 14 days and can be filled once.</p>
      )}
    </div>
  );
}

// Approve a submitted onboarding → create the staff member with a chosen role.
export function ApproveControl({ id, roles }: { id: string; roles: string[] }) {
  const router = useRouter();
  const [role, setRole] = useState(roles.includes("COACH") ? "COACH" : roles[0]);
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
