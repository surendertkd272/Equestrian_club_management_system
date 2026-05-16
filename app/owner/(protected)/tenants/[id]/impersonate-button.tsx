"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

export function ImpersonateButton({
  tenantId,
  userId,
  userName,
  canImpersonate,
}: {
  tenantId: string;
  userId: string;
  userName: string;
  canImpersonate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!canImpersonate) return null;

  async function go() {
    const ok = await openConfirm({
      title: `Sign in as ${userName}?`,
      body: "Every action you take will show up as theirs in the tenant audit log.",
      confirmLabel: "Sign in as",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/tenants/${tenantId}/impersonate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      router.push(data.redirect ?? "/dashboard");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className="rounded border border-indigo-500 px-2 py-0.5 text-[11px] uppercase tracking-wide text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-60"
      title="Sign in as this user (audited)"
    >
      {busy ? "…" : "Sign in as"}
    </button>
  );
}
