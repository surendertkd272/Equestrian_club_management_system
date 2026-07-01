"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Item = { key: string; label: string; type: "doc" | "detail" };

const DATE_KEYS = new Set(["dob", "dateOfJoining"]);
const NUMBER_KEYS = new Set(["agreedSalary", "foodCharges"]);
const TEXTAREA_KEYS = new Set(["permanentAddress", "prevEmployment", "references"]);

export function MyDocumentsForm({ pending }: { pending: Item[] }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(key: string, v: string) {
    setVals((p) => ({ ...p, [key]: v }));
  }

  async function upload(key: string, file: File) {
    setUploading(key);
    try {
      const fd = new FormData();
      fd.append("kind", "onboarding_doc");
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Upload failed");
        return;
      }
      set(key, data.url);
      toast.success("Uploaded");
    } finally {
      setUploading(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(vals)) if (v) payload[k] = v;
    if (Object.keys(payload).length === 0) {
      toast.error("Fill or upload at least one item first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/staff-onboarding/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success("Saved — thank you");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function field(it: Item) {
    if (it.type === "doc") {
      return (
        <div key={it.key} className="space-y-1">
          <Label className="text-xs">{it.label}</Label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => e.target.files?.[0] && upload(it.key, e.target.files[0])}
            className="block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-muted file:px-2 file:py-1 file:text-xs"
          />
          {uploading === it.key ? (
            <span className="text-[11px] text-muted-foreground">Uploading…</span>
          ) : vals[it.key] ? (
            <span className="text-[11px] text-emerald-600">✓ Uploaded</span>
          ) : null}
        </div>
      );
    }
    const v = vals[it.key] ?? "";
    return (
      <div key={it.key} className="space-y-1">
        <Label className="text-xs">{it.label}</Label>
        {it.key === "maritalStatus" ? (
          <Select value={v} onChange={(e) => set(it.key, e.target.value)}>
            <option value="">—</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="other">Other</option>
          </Select>
        ) : it.key === "employmentType" ? (
          <Select value={v} onChange={(e) => set(it.key, e.target.value)}>
            <option value="">—</option>
            <option value="full_time">Full Employment</option>
            <option value="trainee_stipend">Trainee on Stipend</option>
          </Select>
        ) : TEXTAREA_KEYS.has(it.key) ? (
          <Textarea rows={2} value={v} onChange={(e) => set(it.key, e.target.value)} />
        ) : (
          <Input
            type={DATE_KEYS.has(it.key) ? "date" : NUMBER_KEYS.has(it.key) ? "number" : "text"}
            value={v}
            onChange={(e) => set(it.key, e.target.value)}
          />
        )}
      </div>
    );
  }

  const docs = pending.filter((p) => p.type === "doc");
  const details = pending.filter((p) => p.type === "detail");

  return (
    <form onSubmit={submit} className="space-y-5">
      {details.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</div>
          <div className="grid gap-3 sm:grid-cols-2">{details.map(field)}</div>
        </div>
      )}
      {docs.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documents</div>
          <div className="grid gap-3 sm:grid-cols-2">{docs.map(field)}</div>
        </div>
      )}
      <Button type="submit" disabled={busy || !!uploading}>
        {busy ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
