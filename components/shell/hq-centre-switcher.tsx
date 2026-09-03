"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

// SUPER_ADMIN + ADMIN picker that scopes every cross-club page to a
// chosen centre. POSTs to /api/hq-centre to persist the cookie, then
// router.refresh() so the next render uses the new scope.

export function HqCentreSwitcher({
  centres,
  selected,
}: {
  centres: { id: string; name: string; slug: string }[];
  selected: string | null; // null = "all centres"
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setBusy(true);
    try {
      const res = await fetch("/api/hq-centre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ centreId: value }),
      });
      if (!res.ok) {
        // A 401 here means the session ended while the tab sat open — the page
        // still LOOKS signed in, so "Couldn't save filter" sent people hunting
        // for a bug in the centre picker when the real answer was "sign in
        // again". Every other failure shows what the server actually said
        // rather than a single catch-all sentence.
        if (res.status === 401) {
          toast.error("Your session has ended. Signing you in again…");
          router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        const data = await res.json().catch(() => ({}));
        toast.error(
          data.error === "FORBIDDEN_CROSS_ORG"
            ? "That centre isn't part of your organisation."
            : (data.message ?? "Couldn't save the centre filter. Please try again."),
        );
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={selected ?? "all"}
      onChange={onChange}
      disabled={busy}
      title="Scope every page to one centre"
      className="h-8 rounded-md border bg-card px-2 text-xs"
    >
      <option value="all">All Centres</option>
      {centres.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}
