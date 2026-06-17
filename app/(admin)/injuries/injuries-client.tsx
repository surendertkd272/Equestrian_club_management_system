"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Horse = { id: string; name: string; stableNo: string | null };
type Rider = { id: string; firstName: string; lastName: string };

export function InjuriesClient({ horses, riders }: { horses: Horse[]; riders: Rider[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    subjectType: "horse" as "horse" | "rider",
    subjectId: horses[0]?.id ?? "",
    occurredAt: new Date().toISOString().slice(0, 10),
    location: "",
    severity: "minor" as "minor" | "moderate" | "severe",
    cause: "",
    initialNotes: "",
  });
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v as any }));
  }

  function changeSubjectType(t: "horse" | "rider") {
    setForm((f) => ({
      ...f,
      subjectType: t,
      subjectId: (t === "horse" ? horses[0]?.id : riders[0]?.id) ?? "",
    }));
  }

  async function submit() {
    if (!form.subjectId || !form.initialNotes) {
      toast.error("Pick a subject and write the initial notes.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/injuries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Logged");
      setForm({
        subjectType: form.subjectType,
        subjectId: form.subjectId,
        occurredAt: new Date().toISOString().slice(0, 10),
        location: "",
        severity: "minor",
        cause: "",
        initialNotes: "",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Log a new injury</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Subject type</Label>
            <Select aria-label="Subject type" value={form.subjectType} onChange={(e) => changeSubjectType(e.target.value as any)}>
              <option value="horse">Horse</option>
              <option value="rider">Rider</option>
            </Select>
          </div>
          <div>
            <Label>{form.subjectType === "horse" ? "Horse" : "Rider"}</Label>
            <Select value={form.subjectId} onChange={(e) => set("subjectId", e.target.value)}>
              {(form.subjectType === "horse" ? horses : riders).map((s: any) =>
                form.subjectType === "horse" ? (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.stableNo ? ` (${s.stableNo})` : ""}
                  </option>
                ) : (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName}
                  </option>
                ),
              )}
            </Select>
          </div>
          <div>
            <Label>Occurred</Label>
            <Input aria-label="Occurred" type="date" value={form.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} />
          </div>
          <div>
            <Label>Location on body</Label>
            <Input aria-label="Location on body" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="left fore fetlock" />
          </div>
          <div>
            <Label>Severity</Label>
            <Select aria-label="Severity" value={form.severity} onChange={(e) => set("severity", e.target.value)}>
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </Select>
          </div>
          <div>
            <Label>Cause</Label>
            <Input aria-label="Cause" value={form.cause} onChange={(e) => set("cause", e.target.value)} placeholder="slipped on wet arena" />
          </div>
          <div className="md:col-span-3">
            <Label>Initial notes *</Label>
            <Textarea aria-label="Initial notes"
              value={form.initialNotes}
              onChange={(e) => set("initialNotes", e.target.value)}
              placeholder="Visible swelling, slight lameness at walk. Cold-hosed 15 min, bute administered."
            />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={submit} disabled={busy}>{busy ? "Logging…" : "Log injury"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function InjuryRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function patch(payload: any, success: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/injuries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(success);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const t = window.prompt("Treatment / care notes:");
          if (!t) return;
          patch({ treatment: t }, "Treatment added");
        }}
        className="inline-flex min-h-[40px] items-center justify-center rounded border px-3 text-sm hover:bg-muted disabled:opacity-50"
      >
        + Treatment
      </button>
      {status !== "recovered" && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            const ok = await openConfirm({
              title: "Mark recovered?",
              body: "The injury record stays in history; the horse goes back on the active roster.",
              confirmLabel: "Mark recovered",
            });
            if (!ok) return;
            patch({ status: "recovered" }, "Marked recovered");
          }}
          className="inline-flex min-h-[40px] items-center justify-center rounded border border-emerald-500 px-3 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          Mark recovered
        </button>
      )}
      {status === "active" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ status: "recovering" }, "Status updated")}
          className="inline-flex min-h-[40px] items-center justify-center rounded border px-3 text-sm hover:bg-muted disabled:opacity-50"
        >
          → Recovering
        </button>
      )}
    </div>
  );
}
