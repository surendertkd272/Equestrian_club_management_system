"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, CircleDot, ArrowRight, X } from "lucide-react";
import type { ChecklistTask } from "@/lib/onboarding/checklist";

// Personal "Getting started" card. Mounted once in the admin shell; shows only
// on the Dashboard, and only for roles that have a starter list (admins use the
// separate SetupChecklist). Universal items (tour, photo) are auto-detected;
// role items are manual ticks. State persists via /api/me/onboarding.
export function OnboardingChecklist({
  tasks,
  autoDone,
  savedChecklist,
  dismissed,
}: {
  tasks: ChecklistTask[];
  autoDone: { tour: boolean; photo: boolean };
  savedChecklist: Record<string, boolean>;
  dismissed: boolean;
}) {
  const pathname = usePathname();
  const [checked, setChecked] = useState<Record<string, boolean>>(savedChecklist);
  const [hidden, setHidden] = useState(dismissed);

  if (pathname !== "/dashboard" || tasks.length === 0 || hidden) return null;

  const isDone = (t: ChecklistTask) => (t.auto ? autoDone[t.auto] : !!checked[t.key]);
  const doneCount = tasks.filter(isDone).length;
  if (doneCount === tasks.length) return null; // all done → quietly retire the card
  const pct = Math.round((doneCount / tasks.length) * 100);

  function patch(body: Record<string, unknown>) {
    fetch("/api/me/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }
  function toggle(key: string) {
    const next = { ...checked, [key]: !checked[key] };
    setChecked(next);
    patch({ checklist: { [key]: next[key] } });
  }
  function dismiss() {
    setHidden(true);
    patch({ dismissChecklist: true });
  }

  return (
    <Card className="mb-4 border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Getting started</CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{doneCount}/{tasks.length} done</span>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss getting-started checklist"
              title="Dismiss"
              className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-card"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm">
          {tasks.map((t) => {
            const done = isDone(t);
            return (
              <li key={t.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-card">
                {t.auto ? (
                  done ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleDot className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => toggle(t.key)}
                    aria-label={done ? "Mark not done" : "Mark done"}
                    className="grid h-4 w-4 shrink-0 place-items-center rounded border border-input"
                  >
                    {done && <Check className="h-3 w-3 text-emerald-600" />}
                  </button>
                )}
                <Link href={t.href} className={`flex flex-1 items-center justify-between ${done ? "opacity-60" : ""}`}>
                  <span className={done ? "line-through" : "font-medium"}>{t.label}</span>
                  {!done && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
