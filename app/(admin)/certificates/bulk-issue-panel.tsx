"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export function BulkIssuePanel({
  events,
  sittings,
}: {
  events: { id: string; label: string }[];
  sittings: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [source, setSource] = useState<"event" | "exam_sitting">("exam_sitting");
  const [sourceId, setSourceId] = useState("");
  const [includeRegistered, setIncludeRegistered] = useState(false);
  const [busy, setBusy] = useState(false);

  // Each source pulls its own dropdown list; the placeholders below shift
  // automatically when the user changes source.
  const list = source === "event" ? events : sittings;

  async function run() {
    if (!sourceId) {
      toast.error("Pick a source first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/certificates/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          sourceId,
          ...(source === "event" ? { includeRegistered } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      const msg = data.alreadyHad
        ? `Issued ${data.issued} new · skipped ${data.alreadyHad} already-issued`
        : `Issued ${data.issued} certificates`;
      toast.success(msg);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-base">Bulk Issue Certificates</CardTitle>
        <CardDescription>
          Pick a source — exam sitting or event — and mint a cert per eligible
          rider in one shot. Re-running on the same source is safe: already-issued certs are
          skipped, only the missing ones are created.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground">Source Kind</label>
            <Select
              value={source}
              onChange={(e) => {
                setSource(e.target.value as any);
                setSourceId("");
              }}
            >
              <option value="exam_sitting">Exam Sitting (Passed Riders → Promotion)</option>
              <option value="event">Event (Attended Riders → event_attendance)</option>
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">Source</label>
            <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">— Choose —</option>
              {list.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </Select>
            {list.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No items found. Run a sitting / event first.
              </p>
            )}
          </div>
        </div>
        {source === "event" && (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeRegistered}
              onChange={(e) => setIncludeRegistered(e.target.checked)}
            />
            Include registered (not just <code>attended</code>) — useful for camps where attendance
            wasn&apos;t tracked.
          </label>
        )}
        <Button onClick={run} disabled={busy || !sourceId}>
          {busy ? "Issuing…" : "Issue certificates"}
        </Button>
      </CardContent>
    </Card>
  );
}
