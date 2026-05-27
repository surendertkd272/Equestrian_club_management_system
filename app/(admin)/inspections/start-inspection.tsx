"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { AUDIT_SCOPES } from "@/lib/schemas/audit-run";

const SCOPE_LABEL: Record<string, string> = {
  inventory: "Tack & equipment inventory",
  vet_inventory: "Vet cabinet & medicines",
  stable: "Stable & feed store",
  full: "Full audit (all areas)",
};

export function StartInspection() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<string>("inventory");

  async function start() {
    setBusy(true);
    try {
      const res = await fetch("/api/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      router.push(`/inspections/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Start an inspection</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px]">
            <Label>Scope</Label>
            <Select value={scope} onChange={(e) => setScope(e.target.value)}>
              {AUDIT_SCOPES.map((s) => (
                <option key={s} value={s}>{SCOPE_LABEL[s] ?? s}</option>
              ))}
            </Select>
          </div>
          <Button onClick={start} disabled={busy}>{busy ? "Starting…" : "Start audit"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
