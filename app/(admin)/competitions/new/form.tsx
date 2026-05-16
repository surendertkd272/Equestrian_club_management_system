"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";

type ClassRow = { name: string; fee: string; ageGroup: string; maxEntries: string };

const blankClass: ClassRow = { name: "", fee: "0", ageGroup: "", maxEntries: "" };

export function NewCompetitionForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    scope: "internal" as "internal" | "inter_school" | "state" | "national",
    discipline: "generic" as "generic" | "dressage" | "jumping" | "eventing" | "gymkhana",
    startDate: today,
    endDate: today,
    venue: "",
    entryDeadline: "",
  });
  const [classes, setClasses] = useState<ClassRow[]>([
    { name: "Junior Walk/Trot", fee: "500", ageGroup: "8-12", maxEntries: "" },
  ]);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function slugify(s: string) {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40);
  }

  function autoslug(v: string) {
    set("name", v);
    if (!form.slug || form.slug === slugify(form.name)) {
      set("slug", slugify(v));
    }
  }

  function updateClass(i: number, key: keyof ClassRow, v: string) {
    setClasses((cs) => cs.map((c, idx) => (idx === i ? { ...c, [key]: v } : c)));
  }
  function addClass() {
    setClasses((cs) => [...cs, { ...blankClass }]);
  }
  function removeClass(i: number) {
    setClasses((cs) => cs.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanClasses = classes
      .filter((c) => c.name.trim())
      .map((c) => {
        const o: any = { name: c.name.trim(), fee: Number(c.fee) || 0 };
        if (c.ageGroup.trim()) o.ageGroup = c.ageGroup.trim();
        if (c.maxEntries) o.maxEntries = Number(c.maxEntries);
        return o;
      });
    if (cleanClasses.length === 0) {
      toast.error("Add at least one class.");
      return;
    }
    setSaving(true);
    const payload: any = {
      ...form,
      classes: cleanClasses,
    };
    if (!form.venue) delete payload.venue;
    if (!form.entryDeadline) delete payload.entryDeadline;
    const res = await fetch("/api/competitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? err.error ?? "Failed");
      return;
    }
    const data = await res.json();
    toast.success("Competition created");
    router.push(`/competitions/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label>Name *</Label>
          <Input
            required
            value={form.name}
            onChange={(e) => autoslug(e.target.value)}
            placeholder="Spring Championship 2026"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Slug *</Label>
          <Input
            required
            value={form.slug}
            onChange={(e) => set("slug", e.target.value)}
            placeholder="spring-championship-2026"
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
          />
          <p className="text-[11px] text-muted-foreground">Used in public URL <code>/scoreboard/{form.slug || "…"}</code></p>
        </div>
        <div className="space-y-1.5">
          <Label>Scope *</Label>
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={form.scope}
            onChange={(e) => set("scope", e.target.value as typeof form.scope)}
          >
            <option value="internal">Internal</option>
            <option value="inter_school">Inter-school</option>
            <option value="state">State</option>
            <option value="national">National</option>
          </select>
          <p className="text-[11px] text-muted-foreground">PRD §4 Module 6 — drives downstream analytics + reporting.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Discipline *</Label>
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={form.discipline}
            onChange={(e) => set("discipline", e.target.value as typeof form.discipline)}
          >
            <option value="generic">Generic (highest score wins)</option>
            <option value="dressage">Dressage (%)</option>
            <option value="jumping">Show jumping (faults + time)</option>
            <option value="eventing">Eventing (combined phases)</option>
            <option value="gymkhana">Gymkhana (fastest time)</option>
          </select>
          <p className="text-[11px] text-muted-foreground">
            Drives scoring fields, tie-break rules, and the public scoreboard layout.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Venue</Label>
          <Input value={form.venue} onChange={(e) => set("venue", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Start date *</Label>
          <Input required type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>End date *</Label>
          <Input required type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Entry deadline (optional)</Label>
          <Input type="date" value={form.entryDeadline} onChange={(e) => set("entryDeadline", e.target.value)} />
        </div>
      </div>

      <div className="space-y-2 rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Classes</Label>
          <Button type="button" variant="outline" size="sm" onClick={addClass}>
            <Plus className="h-3 w-3" /> Add class
          </Button>
        </div>
        {classes.map((c, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <Input
              className="col-span-5"
              required
              value={c.name}
              onChange={(e) => updateClass(i, "name", e.target.value)}
              placeholder="Class name"
            />
            <Input
              className="col-span-2"
              type="number"
              min={0}
              value={c.fee}
              onChange={(e) => updateClass(i, "fee", e.target.value)}
              placeholder="Fee ₹"
            />
            <Input
              className="col-span-2"
              value={c.ageGroup}
              onChange={(e) => updateClass(i, "ageGroup", e.target.value)}
              placeholder="Age (8-12)"
            />
            <Input
              className="col-span-2"
              type="number"
              min={1}
              value={c.maxEntries}
              onChange={(e) => updateClass(i, "maxEntries", e.target.value)}
              placeholder="Max"
            />
            <button
              type="button"
              onClick={() => removeClass(i)}
              disabled={classes.length === 1}
              className="col-span-1 grid place-items-center rounded-md border bg-card text-muted-foreground hover:bg-muted disabled:opacity-30"
              aria-label="remove"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Creating…" : "Create competition (draft)"}
      </Button>
    </form>
  );
}
