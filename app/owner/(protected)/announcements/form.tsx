"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const SEVERITIES = ["info", "success", "warning", "maintenance"] as const;

export function NewAnnouncementForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    body: "",
    severity: "info" as (typeof SEVERITIES)[number],
    ctaLabel: "",
    ctaHref: "",
    planFilter: "",
    roleFilter: "",
    expiresAt: "",
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function publish() {
    if (!form.title || !form.body) {
      toast.error("Title + body required.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/owner/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        body: form.body,
        severity: form.severity,
        ctaLabel: form.ctaLabel || null,
        ctaHref: form.ctaHref || null,
        planFilter: form.planFilter || null,
        roleFilter: form.roleFilter || null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.message ?? data.error ?? "Failed");
      return;
    }
    toast.success("Published.");
    setForm({ title: "", body: "", severity: "info", ctaLabel: "", ctaHref: "", planFilter: "", roleFilter: "", expiresAt: "" });
    router.refresh();
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label className="text-xs text-slate-400">Title</Label>
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} className="border-slate-700 bg-slate-950 text-slate-100" />
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs text-slate-400">Body</Label>
        <textarea
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
          className="min-h-[80px] w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100"
          placeholder="One or two sentences. No HTML."
        />
      </div>
      <div>
        <Label className="text-xs text-slate-400">Severity</Label>
        <select
          value={form.severity}
          onChange={(e) => set("severity", e.target.value as any)}
          className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"
        >
          {SEVERITIES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </div>
      <div>
        <Label className="text-xs text-slate-400">Expires (optional)</Label>
        <Input type="datetime-local" value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} className="border-slate-700 bg-slate-950 text-slate-100" />
      </div>
      <div>
        <Label className="text-xs text-slate-400">CTA label</Label>
        <Input value={form.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} className="border-slate-700 bg-slate-950 text-slate-100" />
      </div>
      <div>
        <Label className="text-xs text-slate-400">CTA URL (https://…)</Label>
        <Input value={form.ctaHref} onChange={(e) => set("ctaHref", e.target.value)} className="border-slate-700 bg-slate-950 text-slate-100" />
      </div>
      <div>
        <Label className="text-xs text-slate-400">Plan filter (CSV, e.g. "starter,pro")</Label>
        <Input value={form.planFilter} onChange={(e) => set("planFilter", e.target.value)} className="border-slate-700 bg-slate-950 text-slate-100" />
      </div>
      <div>
        <Label className="text-xs text-slate-400">Role filter (CSV, e.g. "CENTRE_MANAGER,COACH")</Label>
        <Input value={form.roleFilter} onChange={(e) => set("roleFilter", e.target.value)} className="border-slate-700 bg-slate-950 text-slate-100" />
      </div>
      <div className="md:col-span-2 flex justify-end">
        <Button onClick={publish} disabled={busy}>{busy ? "Publishing…" : "Publish"}</Button>
      </div>
    </div>
  );
}
