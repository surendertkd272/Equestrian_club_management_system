"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Item = { id: string; label: string };
type LiveIssuance = { id: string; recipient: string };

export function IssueReturn({
  assetId,
  liveIssuance,
  riders,
  horses,
  users,
}: {
  assetId: string;
  liveIssuance: LiveIssuance | null;
  riders: Item[];
  horses: Item[];
  users: Item[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{liveIssuance ? "Return asset" : "Issue asset"}</CardTitle>
      </CardHeader>
      <CardContent>
        {liveIssuance ? (
          <ReturnForm assetId={assetId} issuanceId={liveIssuance.id} recipient={liveIssuance.recipient} />
        ) : (
          <IssueForm assetId={assetId} riders={riders} horses={horses} users={users} />
        )}
      </CardContent>
    </Card>
  );
}

function IssueForm({
  assetId,
  riders,
  horses,
  users,
}: {
  assetId: string;
  riders: Item[];
  horses: Item[];
  users: Item[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<"rider" | "horse" | "user">("rider");
  const [targetId, setTargetId] = useState<string>(riders[0]?.id ?? "");
  const [note, setNote] = useState("");

  function onTargetChange(t: "rider" | "horse" | "user") {
    setTarget(t);
    const pool = t === "rider" ? riders : t === "horse" ? horses : users;
    setTargetId(pool[0]?.id ?? "");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const body: any = { note: note || undefined };
    if (target === "rider") body.issuedToRiderId = targetId;
    if (target === "horse") body.issuedToHorseId = targetId;
    if (target === "user") body.issuedToUserId = targetId;
    const res = await fetch(`/api/assets/${assetId}/issuances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? err.error ?? "Failed");
      return;
    }
    toast.success("Issued");
    router.refresh();
  }

  const pool = target === "rider" ? riders : target === "horse" ? horses : users;

  return (
    <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-4 md:items-end">
      <div className="space-y-1.5">
        <Label>Issue to</Label>
        <Select value={target} onChange={(e) => onTargetChange(e.target.value as any)}>
          <option value="rider">Rider</option>
          <option value="horse">Horse</option>
          <option value="user">Staff</option>
        </Select>
      </div>
      <div className="md:col-span-2 space-y-1.5">
        <Label>Recipient</Label>
        <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
          {pool.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {pool.length === 0 && <option value="">(none available)</option>}
        </Select>
      </div>
      <div className="md:col-span-1 space-y-1.5">
        <Label>Note</Label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
      </div>
      <div className="md:col-span-4">
        <Button type="submit" disabled={saving || !targetId} className="w-full md:w-auto">
          {saving ? "Issuing…" : "Issue"}
        </Button>
      </div>
    </form>
  );
}

function ReturnForm({
  assetId,
  issuanceId,
  recipient,
}: {
  assetId: string;
  issuanceId: string;
  recipient: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [condition, setCondition] = useState<"good" | "damaged" | "lost">("good");
  const [note, setNote] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/assets/${assetId}/issuances/${issuanceId}/return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conditionAtReturn: condition, note: note || undefined }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed");
      return;
    }
    const data = await res.json();
    toast.success(
      condition === "good"
        ? "Returned · back in service"
        : `Returned · ${condition} · maintenance ticket opened`,
    );
    setNote("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-4 md:items-end">
      <div className="md:col-span-4 text-sm">
        Returning from <b>{recipient}</b>
      </div>
      <div className="space-y-1.5">
        <Label>Condition</Label>
        <Select value={condition} onChange={(e) => setCondition(e.target.value as any)}>
          <option value="good">Good — back in service</option>
          <option value="damaged">Damaged — needs repair</option>
          <option value="lost">Lost</option>
        </Select>
      </div>
      <div className="md:col-span-2 space-y-1.5">
        <Label>Note</Label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={condition === "good" ? "optional" : "What broke / where last seen"}
        />
      </div>
      <div className="md:col-span-4">
        <Button type="submit" disabled={saving} className="w-full md:w-auto">
          {saving ? "Returning…" : "Return"}
        </Button>
      </div>
    </form>
  );
}
