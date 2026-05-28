"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

const EXAMPLE = JSON.stringify(
  [
    {
      name: "Dress & Equipment",
      items: [
        { name: "Helmet", max_score: 5 },
        { name: "Boots", max_score: 5 },
      ],
    },
    {
      name: "Riding Position",
      items: [
        { name: "Seat", max_score: 10 },
        { name: "Hands", max_score: 10 },
        { name: "Heels", max_score: 5 },
      ],
    },
    {
      name: "Movements",
      items: [
        { name: "Walk", max_score: 10 },
        { name: "Trot", max_score: 10 },
      ],
    },
    {
      name: "Remarks by Jury",
      type: "text",
      items: [{ name: "Overall notes", max_score: 0 }],
    },
  ],
  null,
  2,
);

// categoriesJson is a native jsonb column — comes back from Prisma as an
// already-parsed value (object/array). Keep the type unknown so this stays
// honest about what we got and the load handler narrows defensively.
type ExistingTemplate = { levelKey: string; levelName: string; passThreshold: number; categoriesJson: unknown };

export function TemplateEditor({ existing }: { existing: ExistingTemplate[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [levelKey, setLevelKey] = useState("1");
  const [levelName, setLevelName] = useState("Level 1");
  const [passThreshold, setPassThreshold] = useState(70);
  const [json, setJson] = useState(EXAMPLE);

  const existingMap = useMemo(() => {
    const m = new Map<string, ExistingTemplate>();
    for (const e of existing) m.set(e.levelKey, e);
    return m;
  }, [existing]);

  function loadExisting(key: string) {
    setLevelKey(key);
    const e = existingMap.get(key);
    if (e) {
      setLevelName(e.levelName);
      setPassThreshold(e.passThreshold);
      // categoriesJson is already-parsed (jsonb). If a legacy row still hands
      // us a string, parse first; otherwise pretty-print directly.
      try {
        const obj = typeof e.categoriesJson === "string" ? JSON.parse(e.categoriesJson) : e.categoriesJson;
        setJson(JSON.stringify(obj, null, 2));
      } catch {
        setJson(typeof e.categoriesJson === "string" ? e.categoriesJson : "");
      }
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    let categories: unknown;
    try {
      categories = JSON.parse(json);
    } catch (err) {
      toast.error("JSON parse error: " + (err as Error).message);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/scoring-templates/${encodeURIComponent(levelKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ levelName, passThreshold, categories }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.details ? "Validation failed — check schema" : err.error ?? "Save failed");
      return;
    }
    toast.success("Template saved");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Level key</Label>
          <Select value={levelKey} onChange={(e) => loadExisting(e.target.value)}>
            {["1", "2", "3", "4"].map((k) => (
              <option key={k} value={k}>
                {k} {existingMap.has(k) ? "(exists)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Level name</Label>
          <Input value={levelName} onChange={(e) => setLevelName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Pass threshold (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={passThreshold}
            onChange={(e) => setPassThreshold(Number(e.target.value))}
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Rubric JSON</Label>
        <Textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={18}
          className="font-mono text-xs"
        />
      </div>
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Saving…" : `Save template — Level ${levelKey}`}
      </Button>
    </form>
  );
}
