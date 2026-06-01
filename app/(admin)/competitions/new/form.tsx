"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";
import { COMPETITION_DISCIPLINE_OPTIONS, SUB_DISCIPLINE_PRESETS } from "@/lib/competition-disciplines";

type DisciplineBlock = { discipline: string; subDisciplines: string[]; customDraft: string };

const newBlock = (): DisciplineBlock => ({ discipline: "", subDisciplines: [], customDraft: "" });

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
  const [blocks, setBlocks] = useState<DisciplineBlock[]>([newBlock()]);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function updateBlock(i: number, patch: Partial<DisciplineBlock>) {
    setBlocks((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function setBlockDiscipline(i: number, discipline: string) {
    // Changing the discipline resets the (now-irrelevant) sub-discipline picks.
    updateBlock(i, { discipline, subDisciplines: [] });
  }
  function toggleSub(i: number, name: string) {
    setBlocks((bs) =>
      bs.map((b, idx) => {
        if (idx !== i) return b;
        const has = b.subDisciplines.includes(name);
        return {
          ...b,
          subDisciplines: has ? b.subDisciplines.filter((s) => s !== name) : [...b.subDisciplines, name],
        };
      }),
    );
  }
  function addCustomSub(i: number) {
    setBlocks((bs) =>
      bs.map((b, idx) => {
        if (idx !== i) return b;
        const name = b.customDraft.trim();
        if (!name || b.subDisciplines.includes(name)) return { ...b, customDraft: "" };
        return { ...b, subDisciplines: [...b.subDisciplines, name], customDraft: "" };
      }),
    );
  }
  function addBlock() {
    setBlocks((bs) => [...bs, newBlock()]);
  }
  function removeBlock(i: number) {
    setBlocks((bs) => bs.filter((_, idx) => idx !== i));
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Flatten the discipline builder into classes: one class per selected
    // sub-discipline. Dedupe by class name (entry validation keys off it).
    const seen = new Set<string>();
    const classes: { name: string; discipline: string; fee: number }[] = [];
    for (const b of blocks) {
      if (!b.discipline) continue;
      for (const sub of b.subDisciplines) {
        const name = sub.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        // Store the discipline KEY so the scoring engine resolves per-event
        // (lib/discipline.ts scoringEngineFor). Display maps key → label.
        classes.push({ name, discipline: b.discipline, fee: 0 });
      }
    }
    if (classes.length === 0) {
      toast.error("Add at least one discipline with a sub-discipline/event.");
      return;
    }
    setSaving(true);
    const payload: any = {
      ...form,
      classes,
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
          <p className="text-[11px] text-muted-foreground">Drives downstream analytics + reporting.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Scoring type *</Label>
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

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Disciplines &amp; events
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Pick a discipline, then choose the sub-disciplines/events it runs. Each becomes a class on the scoreboard.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addBlock}>
            <Plus className="h-3 w-3" /> Add discipline
          </Button>
        </div>

        {blocks.map((b, i) => {
          const presets = SUB_DISCIPLINE_PRESETS[b.discipline] ?? [];
          const customs = b.subDisciplines.filter((s) => !presets.includes(s));
          return (
            <div key={i} className="rounded-md border bg-muted/30 p-3">
              <div className="grid gap-3 md:grid-cols-2">
                {/* Left: discipline */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Discipline</Label>
                    {blocks.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeBlock(i)}
                        className="grid h-6 w-6 place-items-center rounded-md border bg-card text-muted-foreground hover:bg-muted"
                        aria-label="remove discipline"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={b.discipline}
                    onChange={(e) => setBlockDiscipline(i, e.target.value)}
                  >
                    <option value="" disabled>
                      Select discipline…
                    </option>
                    {COMPETITION_DISCIPLINE_OPTIONS.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Right: sub-disciplines */}
                <div className="space-y-1.5">
                  <Label>Sub-disciplines / events</Label>
                  {!b.discipline ? (
                    <p className="text-[11px] text-muted-foreground">Select a discipline first.</p>
                  ) : (
                    <div className="space-y-2">
                      {presets.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {presets.map((sub) => {
                            const active = b.subDisciplines.includes(sub);
                            return (
                              <button
                                key={sub}
                                type="button"
                                onClick={() => toggleSub(i, sub)}
                                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                  active
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "bg-card text-foreground hover:bg-muted"
                                }`}
                              >
                                {sub}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {customs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {customs.map((sub) => (
                            <span
                              key={sub}
                              className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                            >
                              {sub}
                              <button
                                type="button"
                                onClick={() => toggleSub(i, sub)}
                                aria-label={`remove ${sub}`}
                                className="opacity-80 hover:opacity-100"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Input
                          className="h-8"
                          value={b.customDraft}
                          onChange={(e) => updateBlock(i, { customDraft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addCustomSub(i);
                            }
                          }}
                          placeholder="Add custom event…"
                        />
                        <Button type="button" variant="outline" size="sm" onClick={() => addCustomSub(i)}>
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Creating…" : "Create competition (draft)"}
      </Button>
    </form>
  );
}
