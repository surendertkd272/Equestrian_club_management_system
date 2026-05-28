"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Item = { id: string; label: string; section: string | null };
type Horse = { id: string; name: string; stableNo: string | null };
type Status = "done" | "not_done" | "na";

type Props = {
  templateId: string;
  scope: "general" | "per_horse";
  items: Item[];
  horses: Horse[];
};

// Section ordering matches the template editor (A first, B second, then others).
const SECTION_ORDER = ["A", "B"];

export function ChecklistSubmissionForm({ templateId, scope, items, horses }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [horseId, setHorseId] = useState(scope === "per_horse" ? horses[0]?.id ?? "" : "");
  const [generalNotes, setGeneralNotes] = useState("");
  // Default everyone to "done" — the coach un-ticks the few that didn't go right.
  const [marks, setMarks] = useState<Record<string, { status: Status; remarks: string }>>(() =>
    Object.fromEntries(items.map((i) => [i.id, { status: "done" as Status, remarks: "" }])),
  );

  const buckets = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const key = it.section ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = SECTION_ORDER.indexOf(a);
      const bi = SECTION_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.localeCompare(b);
    });
  }, [items]);

  function setStatus(id: string, status: Status) {
    setMarks((m) => ({ ...m, [id]: { ...m[id], status } }));
  }
  function setRemarks(id: string, remarks: string) {
    setMarks((m) => ({ ...m, [id]: { ...m[id], remarks } }));
  }

  async function submit() {
    if (scope === "per_horse" && !horseId) {
      toast.error("Pick a horse first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/checklists/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          horseId: scope === "per_horse" ? horseId : undefined,
          generalNotes: generalNotes.trim() || undefined,
          items: items.map((it) => ({
            itemId: it.id,
            status: marks[it.id]?.status ?? "done",
            remarks: marks[it.id]?.remarks?.trim() || undefined,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Submitted");
      // Reset to defaults for the next horse / next day.
      setMarks(Object.fromEntries(items.map((i) => [i.id, { status: "done" as Status, remarks: "" }])));
      setGeneralNotes("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {scope === "per_horse" && (
        <div className="max-w-xs">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Horse
          </label>
          {horses.length === 0 ? (
            <div className="text-sm text-muted-foreground">No horses available.</div>
          ) : (
            <Select value={horseId} onChange={(e) => setHorseId(e.target.value)}>
              {horses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                  {h.stableNo ? ` (${h.stableNo})` : ""}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}

      {buckets.map(([section, rows]) => (
        <div key={section} className="space-y-2">
          {scope === "general" && (
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Section {section === "—" ? "Other" : section}
            </div>
          )}
          <ul className="divide-y rounded-md border">
            {rows.map((it) => {
              const m = marks[it.id] ?? { status: "done" as Status, remarks: "" };
              return (
                <li key={it.id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[200px] flex-1 text-sm">{it.label}</div>
                    <div className="flex gap-1">
                      <StatusBtn
                        active={m.status === "done"}
                        tone="green"
                        onClick={() => setStatus(it.id, "done")}
                      >
                        Done
                      </StatusBtn>
                      <StatusBtn
                        active={m.status === "not_done"}
                        tone="amber"
                        onClick={() => setStatus(it.id, "not_done")}
                      >
                        Issue
                      </StatusBtn>
                      <StatusBtn
                        active={m.status === "na"}
                        tone="muted"
                        onClick={() => setStatus(it.id, "na")}
                      >
                        N/A
                      </StatusBtn>
                    </div>
                  </div>
                  {m.status === "not_done" && (
                    <Input
                      className="mt-2"
                      placeholder="What went wrong?"
                      value={m.remarks}
                      onChange={(e) => setRemarks(it.id, e.target.value)}
                      maxLength={500}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          General notes (optional)
        </label>
        <Textarea
          rows={2}
          value={generalNotes}
          onChange={(e) => setGeneralNotes(e.target.value)}
          maxLength={2000}
          placeholder="Anything the next shift should know?"
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy || items.length === 0}>
          {busy ? "Submitting…" : "Submit checklist"}
        </Button>
      </div>
    </div>
  );
}

function StatusBtn({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "green" | "amber" | "muted";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = "rounded-md border px-2 py-1 text-xs font-medium transition";
  const inactive = "border-input bg-background text-muted-foreground hover:bg-muted";
  const activeMap: Record<string, string> = {
    green: "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    amber: "border-amber-600 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    muted: "border-zinc-400 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? activeMap[tone] : inactive}`}
    >
      {children}
    </button>
  );
}
