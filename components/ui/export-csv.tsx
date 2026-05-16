"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

// Fetches /api/export/<entity>, reads truncation headers, and triggers a
// Blob download. Falls back to a plain link if scripting fails. The fetch
// path lets us surface a "got 5000 of 12450 — refine filters" toast that a
// plain anchor can't.
export function ExportCsvButton({
  entity,
  label = "Export CSV",
  query,
}: {
  entity: "riders" | "horses" | "attendance" | "invoices" | "audit";
  label?: string;
  query?: string;
}) {
  const [busy, setBusy] = useState(false);
  const href = `/api/export/${entity}${query ? `?${query}` : ""}`;

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        toast.error("Export failed");
        return;
      }
      const total = Number(res.headers.get("x-total-count") ?? "0");
      const returned = Number(res.headers.get("x-returned-count") ?? "0");
      const truncated = res.headers.get("x-truncated") === "1";

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entity}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (truncated) {
        toast.warning(
          `Export capped at ${returned.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} rows. Refine filters for a smaller slice.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <a
      href={href}
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-sm hover:bg-muted"
      title="Download as CSV (opens in Excel/Sheets)"
    >
      <Download className="h-4 w-4" /> {busy ? "Preparing…" : label}
    </a>
  );
}
