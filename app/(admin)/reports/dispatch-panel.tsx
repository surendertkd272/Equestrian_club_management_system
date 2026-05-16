"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function DispatchPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ notified: number; skipped: number; scanned: number } | null>(null);

  async function trigger() {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/reports/monthly-dispatch", { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Failed");
      return;
    }
    const r = data.result;
    setResult({ notified: r.notified, skipped: r.skipped, scanned: r.scanned });
    toast.success(`Sent ${r.notified} report${r.notified === 1 ? "" : "s"}, skipped ${r.skipped}.`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button onClick={trigger} disabled={busy}>
        {busy ? "Dispatching…" : "Send last month's report cards now"}
      </Button>
      {result && (
        <p className="text-xs text-muted-foreground">
          Scanned {result.scanned} rider{result.scanned === 1 ? "" : "s"} · sent {result.notified} ·
          skipped {result.skipped} (already received or no email on file).
        </p>
      )}
    </div>
  );
}
