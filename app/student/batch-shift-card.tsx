"use client";

// Rider-side 'request a batch shift' card. Two flavours: single-day
// ('I can't make Wednesday, can I attend Thursday's batch this week?')
// and permanent ('switching schools, need the morning slot'). Behind a
// disclosure so the dashboard isn't dominated by something a typical
// rider does rarely.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { formatEnum } from "@/lib/labels";
type Batch = { id: string; name: string; dayOfWeek: string; startTime: string; endTime: string };
type Request = {
  id: string;
  kind: string;
  shiftDate: string | null;
  toBatch: { name: string };
  fromBatch: { name: string } | null;
  status: string;
  decisionNote: string | null;
  createdAt: string;
};

export function BatchShiftCard({
  currentBatchId,
  batches,
  recent,
}: {
  currentBatchId: string | null;
  batches: Batch[];
  recent: Request[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"single_day" | "permanent">("single_day");
  const [toBatchId, setToBatchId] = useState("");
  const [shiftDate, setShiftDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const eligibleBatches = batches.filter((b) => b.id !== currentBatchId);

  async function submit() {
    if (!toBatchId) return toast.error("Pick a target batch.");
    if (kind === "single_day" && !shiftDate) return toast.error("Pick the date you want to attend.");
    setBusy(true);
    try {
      const res = await fetch("/api/batch-shift-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          toBatchId,
          shiftDate: kind === "single_day" ? shiftDate : undefined,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Request submitted — your coach will be notified");
      setOpen(false);
      setToBatchId("");
      setShiftDate("");
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Batch Shift Requests</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
            {open ? "Cancel" : "Request a shift"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {open && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs">Type *</Label>
                <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as "single_day" | "permanent")}>
                  <option value="single_day">Single day — one-time class swap</option>
                  <option value="permanent">Permanent — change my batch from now on</option>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Target Batch *</Label>
                <Select aria-label="Target batch" value={toBatchId} onChange={(e) => setToBatchId(e.target.value)}>
                  <option value="">— pick a batch —</option>
                  {eligibleBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {b.dayOfWeek.replaceAll(",", " · ")} · {b.startTime}-{b.endTime}
                    </option>
                  ))}
                </Select>
              </div>
              {kind === "single_day" && (
                <div className="md:col-span-2">
                  <Label className="text-xs">Date You Want to Attend *</Label>
                  <Input aria-label="Date you want to attend"
                    type="date"
                    value={shiftDate}
                    onChange={(e) => setShiftDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                  />
                </div>
              )}
              <div className="md:col-span-2">
                <Label className="text-xs">Reason (optional)</Label>
                <Textarea aria-label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="School test, family event, …" />
              </div>
            </div>
            <Button onClick={submit} disabled={busy} size="sm">
              {busy ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        )}

        {recent.length === 0 ? (
          <p className="text-muted-foreground">No batch shift requests yet.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((r) => (
              <li key={r.id} className="rounded-md border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {r.kind === "single_day" ? "Single-day" : "Permanent"} → {r.toBatch.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.kind === "single_day" && r.shiftDate ? `For ${formatDate(new Date(r.shiftDate))}` : "From approval onward"}
                      {" · submitted "}{formatDate(new Date(r.createdAt))}
                    </div>
                    {r.decisionNote && (
                      <div className="mt-1 text-xs italic text-muted-foreground">"{r.decisionNote}"</div>
                    )}
                  </div>
                  <Badge
                    variant={
                      r.status === "approved"
                        ? "success"
                        : r.status === "rejected"
                          ? "destructive"
                          : "warning"
                    }
                  >
                    {formatEnum(r.status)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
