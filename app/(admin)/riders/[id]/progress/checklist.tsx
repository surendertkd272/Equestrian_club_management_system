"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { patchJson } from "@/lib/client/post-json";
import { Badge } from "@/components/ui/badge";
import { NEXT_STATUS, type SkillStatus } from "@/lib/schemas/progress";
import { cn } from "@/lib/utils";
import { Check, Circle, CircleDot } from "lucide-react";

type Skill = { id: string; name: string; discipline: string; status: SkillStatus };

const STATUS_META: Record<SkillStatus, { cls: string; label: string; icon: any }> = {
  not_started: { cls: "border-input bg-card text-muted-foreground hover:bg-muted", label: "not started", icon: Circle },
  in_progress: { cls: "border-amber-400 bg-warning-soft text-warning-foreground", label: "in progress", icon: CircleDot },
  mastered: { cls: "border-emerald-500 bg-success-soft text-success-foreground", label: "mastered", icon: Check },
};

export function SkillChecklist({
  riderId,
  skills,
  canEdit,
}: {
  riderId: string;
  skills: Skill[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // Optimistic state — flips locally first, then refreshes from server on success.
  const [local, setLocal] = useState<Record<string, SkillStatus>>(() =>
    Object.fromEntries(skills.map((s) => [s.id, s.status])),
  );

  async function cycle(skill: Skill) {
    if (!canEdit) return;
    const current = local[skill.id] ?? "not_started";
    const next = NEXT_STATUS[current];
    setLocal((s) => ({ ...s, [skill.id]: next }));
    setBusy(skill.id);
    const res = await patchJson(`/api/riders/${riderId}/skills/${skill.id}`, { status: next });
    setBusy(null);
    if (!res.ok) {
      // Roll back optimistic update
      setLocal((s) => ({ ...s, [skill.id]: current }));
      toast.error(res.message);
      return;
    }
    if (next === "mastered") toast.success(`${skill.name} · mastered`);
    router.refresh();
  }

  // Group by discipline for the rendered tables.
  const byDiscipline = new Map<string, Skill[]>();
  for (const s of skills) {
    if (!byDiscipline.has(s.discipline)) byDiscipline.set(s.discipline, []);
    byDiscipline.get(s.discipline)!.push(s);
  }

  if (skills.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No skills defined for this level. Ask a Super Admin to add them.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {Array.from(byDiscipline.entries()).map(([discipline, list]) => (
        <div key={discipline}>
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {discipline.replaceAll("_", " ")}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {list.map((s) => {
              const status = local[s.id] ?? "not_started";
              const meta = STATUS_META[status];
              const Icon = meta.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => cycle(s)}
                  disabled={!canEdit || busy === s.id}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    meta.cls,
                    !canEdit && "cursor-default",
                  )}
                  title={canEdit ? `Tap to cycle status (now: ${meta.label})` : meta.label}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="flex-1">{s.name}</span>
                  {canEdit && status === "mastered" && (
                    <Badge variant="success" className="ml-2">
                      ✓
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {canEdit && (
        <p className="pt-2 text-[11px] text-muted-foreground">
          Tap a skill to cycle <b>not started</b> → <b>in progress</b> → <b>mastered</b> → not started.
        </p>
      )}
    </div>
  );
}
