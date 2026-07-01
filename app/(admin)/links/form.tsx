"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { postJson } from "@/lib/client/post-json";

const KINDS = [
  { value: "injury", label: "Report a Horse Injury", needsHorse: true, targetHint: "/injuries/new" },
  { value: "rider_onboard", label: "Rider Onboarding (Parent Fills It)", needsHorse: false, targetHint: "/onboarding" },
  { value: "expense_submit", label: "Submit an Invoice", needsHorse: false, targetHint: "/expenses/submit" },
  { value: "requisition", label: "Raise a Requisition", needsHorse: false, targetHint: "/requisitions/new" },
  { value: "vet_visit_horse", label: "Record a vet visit (per horse)", needsHorse: true, targetHint: "/horses/[id] (auto)" },
  { value: "generic", label: "Other — Custom Path", needsHorse: false, targetHint: "" },
] as const;

export function NewShortLinkForm({ horses }: { horses: { id: string; name: string }[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("injury");
  const [horseId, setHorseId] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("14");
  const [singleUse, setSingleUse] = useState(false);
  const [saving, setSaving] = useState(false);

  const kindMeta = KINDS.find((k) => k.value === kind)!;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (kindMeta.needsHorse && !horseId) {
      toast.error("Pick a horse for this link kind.");
      return;
    }
    if (kind === "generic" && !customPath.trim()) {
      toast.error("Custom target path is required for 'Other'.");
      return;
    }

    // Build params per kind.
    const params: Record<string, string> = {};
    if (horseId) params.horseId = horseId;

    // For vet_visit_horse the targetPath embeds the horse id.
    const targetPath =
      kind === "vet_visit_horse" && horseId
        ? `/horses/${horseId}`
        : kind === "generic"
          ? customPath.trim()
          : undefined;

    setSaving(true);
    const res = await postJson("/api/short-links", {
      kind,
      targetPath,
      params: Object.keys(params).length > 0 ? params : undefined,
      label: label.trim() || undefined,
      expiresInDays: Number(expiresInDays),
      singleUse,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Link created");
    setLabel("");
    setHorseId("");
    setCustomPath("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Kind *</Label>
          <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
          <div className="mt-1 text-xs text-muted-foreground">
            Goes to <code>{kindMeta.targetHint || "—"}</code>
          </div>
        </div>

        {kindMeta.needsHorse && (
          <div>
            <Label>Horse *</Label>
            <Select aria-label="Horse" value={horseId} onChange={(e) => setHorseId(e.target.value)}>
              <option value="">— pick —</option>
              {horses.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </Select>
          </div>
        )}

        {kind === "generic" && (
          <div className="md:col-span-2">
            <Label>Target Path *</Label>
            <Input aria-label="Target path"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="/some/path"
            />
            <div className="mt-1 text-xs text-muted-foreground">
              Must start with <code>/</code>. No protocol/host.
            </div>
          </div>
        )}

        <div>
          <Label>Display Label (optional)</Label>
          <Input aria-label="Display label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='e.g. "Injury report — Bijli"'
          />
        </div>

        <div>
          <Label>Expires In (days)</Label>
          <Input aria-label="Expires in (days)"
            type="number"
            min={1}
            max={90}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          />
        </div>

        <div className="md:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={singleUse}
              onChange={(e) => setSingleUse(e.target.checked)}
            />
            One-time use only (the link expires the first time it's opened)
          </label>
        </div>
      </div>

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Creating…" : "Create link"}
      </Button>
    </form>
  );
}
