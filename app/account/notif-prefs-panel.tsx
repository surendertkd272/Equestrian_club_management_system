"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

type Prefs = {
  inApp: boolean;
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

export function NotifPrefsPanel({ initial }: { initial: Prefs }) {
  const router = useRouter();
  const [form, setForm] = useState<Prefs>(initial);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const dirty =
    form.inApp !== initial.inApp ||
    form.email !== initial.email ||
    form.sms !== initial.sms ||
    form.whatsapp !== initial.whatsapp ||
    form.quietHoursStart !== initial.quietHoursStart ||
    form.quietHoursEnd !== initial.quietHoursEnd;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/account/notif-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Preferences saved");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <CardDescription>
          Pick which channels to receive normal notifications on. Critical alerts (severe injury,
          password reset) always land in your in-app inbox regardless.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle label="In-app inbox" hint="The bell icon up top." checked={form.inApp} onChange={(v) => set("inApp", v)} />
          <Toggle label="Email" hint="Goes to the email on your account." checked={form.email} onChange={(v) => set("email", v)} />
          <Toggle label="SMS" hint="Costs ₹0.20–0.50 per message; opt in only if you really want it." checked={form.sms} onChange={(v) => set("sms", v)} />
          <Toggle label="WhatsApp" hint="Most reliable on Indian networks." checked={form.whatsapp} onChange={(v) => set("whatsapp", v)} />
        </div>

        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Quiet hours (optional)
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Non-critical notifications are skipped during this window. Leave blank to disable.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="qhs">Start</Label>
              <Input
                id="qhs"
                type="time"
                value={form.quietHoursStart}
                onChange={(e) => set("quietHoursStart", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="qhe">End</Label>
              <Input
                id="qhe"
                type="time"
                value={form.quietHoursEnd}
                onChange={(e) => set("quietHoursEnd", e.target.value)}
              />
            </div>
          </div>
        </div>

        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save preferences"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3 hover:bg-muted/30">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 cursor-pointer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex-1">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
