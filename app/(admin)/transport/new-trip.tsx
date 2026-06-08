"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function NewTripForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ eventName: "", venue: "", departureAt: "", notes: "" });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function create() {
    if (!form.eventName || !form.venue || !form.departureAt) {
      toast.error("Event, venue and departure are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/venue-trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Trip created — add the manifest");
      router.push(`/transport/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Plan a trip</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <Label>Event</Label>
            <Input aria-label="Event" value={form.eventName} onChange={(e) => set("eventName", e.target.value)} placeholder="EFI Nationals" />
          </div>
          <div>
            <Label>Venue</Label>
            <Input aria-label="Venue" value={form.venue} onChange={(e) => set("venue", e.target.value)} placeholder="Delhi Riding Club" />
          </div>
          <div>
            <Label>Departure</Label>
            <Input aria-label="Departure" type="datetime-local" value={form.departureAt} onChange={(e) => set("departureAt", e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Input aria-label="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Create trip"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
