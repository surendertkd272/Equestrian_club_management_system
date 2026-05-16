// Top-of-page banner shown when the current tenant session was minted by a
// platform OWNER_ADMIN via /api/owner/tenants/[id]/impersonate. The "Stop &
// return to /owner" button POSTs to /api/owner/impersonate/stop which restores
// the owner's own cookie and redirects.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImpersonationBanner({
  impersonatedBy,
  userName,
}: {
  impersonatedBy: string | undefined;
  userName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!impersonatedBy) return null;

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch("/api/owner/impersonate/stop", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      router.push(data.redirect ?? "/owner");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-indigo-400 bg-indigo-50 px-6 py-2 text-sm text-indigo-900">
      <span className="font-semibold">Impersonating</span>{" "}
      <span>{userName}</span>
      <span className="ml-2 text-indigo-700">
        Every action below is audited as this user. Owner audit log records who started this.
      </span>
      <button
        onClick={stop}
        disabled={busy}
        className="ml-3 rounded border border-indigo-400 bg-indigo-100 px-2 py-0.5 text-xs font-medium hover:bg-indigo-200 disabled:opacity-60"
      >
        {busy ? "Stopping…" : "Stop impersonating →"}
      </button>
    </div>
  );
}
