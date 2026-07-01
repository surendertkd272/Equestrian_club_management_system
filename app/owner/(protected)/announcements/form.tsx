"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { postJson } from "@/lib/client/post-json";

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
    const res = await postJson("/api/owner/announcements", {
      title: form.title,
      body: form.body,
      severity: form.severity,
      ctaLabel: form.ctaLabel || null,
      ctaHref: form.ctaHref || null,
      planFilter: form.planFilter || null,
      roleFilter: form.roleFilter || null,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Published.");
    setForm({ title: "", body: "", severity: "info", ctaLabel: "", ctaHref: "", planFilter: "", roleFilter: "", expiresAt: "" });
    router.refresh();
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label className="text-xs text-muted-foreground">Title</Label>
        <Input aria-label="Title" value={form.title} onChange={(e) => set("title", e.target.value)} className="border-border bg-background text-foreground" />
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs text-muted-foreground">Body</Label>
        <textarea
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
          className="min-h-[80px] w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
          placeholder="One or two sentences. No HTML."
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Severity</Label>
        <select
          value={form.severity}
          onChange={(e) => set("severity", e.target.value as any)}
          className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
        >
          {SEVERITIES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Expires (optional)</Label>
        <Input aria-label="Expires (optional)" type="datetime-local" value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} className="border-border bg-background text-foreground" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">CTA Label</Label>
        <Input aria-label="CTA label" value={form.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} className="border-border bg-background text-foreground" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">CTA URL (https://…)</Label>
        <Input aria-label="CTA URL (https://…)" value={form.ctaHref} onChange={(e) => set("ctaHref", e.target.value)} className="border-border bg-background text-foreground" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Plan Filter (CSV, e.g. "starter,pro")</Label>
        <Input aria-label="Plan filter (CSV, e.g. &quot;starter,pro&quot;)" value={form.planFilter} onChange={(e) => set("planFilter", e.target.value)} className="border-border bg-background text-foreground" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Role Filter (CSV, e.g. "CENTRE_MANAGER,COACH")</Label>
        <Input aria-label="Role filter (CSV, e.g. &quot;CENTRE_MANAGER,COACH&quot;)" value={form.roleFilter} onChange={(e) => set("roleFilter", e.target.value)} className="border-border bg-background text-foreground" />
      </div>
      <div className="md:col-span-2 flex justify-end">
        <Button onClick={publish} disabled={busy}>{busy ? "Publishing…" : "Publish"}</Button>
      </div>
    </div>
  );
}
