"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ArrowRight, X } from "lucide-react";
import type { ChecklistTask } from "@/lib/onboarding/checklist";

// Personal "Getting started" card. Mounted once in the admin shell; shows only
// on the Dashboard, and only for roles that have a starter list (admins use the
// separate SetupChecklist). Universal items (tour, photo) are auto-detected;
// role items are manual ticks. State persists via /api/me/onboarding.
//
// Visual: a progress ring + a vertical timeline (done = filled check, the next
// step highlighted, the rest hollow), styled from the app's tokens so it reads
// correctly in light and dark.
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
  const nextIdx = tasks.findIndex((t) => !isDone(t)); // first incomplete = "current"

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

  const bead = (done: boolean, current: boolean) =>
    `grid h-6 w-6 flex-none place-items-center rounded-full border-2 transition ${
      done
        ? "border-emerald-500 bg-emerald-500 text-white"
        : current
          ? "border-primary text-primary"
          : "border-muted-foreground/30 text-transparent"
    }`;

  return (
    <Card className="mb-4 border-primary/20 bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div
            className="grid h-14 w-14 flex-none place-items-center rounded-full"
            style={{ background: `conic-gradient(hsl(var(--primary)) 0 ${pct}%, hsl(var(--muted)) ${pct}% 100%)` }}
            aria-hidden
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-card text-sm font-bold tabular-nums">
              {doneCount}/{tasks.length}
            </span>
          </div>
          <div className="flex-1">
            <CardTitle className="text-base">Getting started</CardTitle>
            <p className="text-xs text-muted-foreground">A few first steps for your account.</p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss getting-started checklist"
            title="Dismiss"
            className="grid h-7 w-7 flex-none place-items-center rounded-md text-muted-foreground transition hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <ol>
          {tasks.map((t, i) => {
            const done = isDone(t);
            const current = !done && i === nextIdx;
            const last = i === tasks.length - 1;
            return (
              <li key={t.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  {t.auto ? (
                    <span className={bead(done, current)}>
                      {done ? <Check className="h-3.5 w-3.5" /> : current ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggle(t.key)}
                      aria-label={done ? "Mark not done" : "Mark done"}
                      className={`${bead(done, current)} cursor-pointer hover:border-primary`}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : current ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                    </button>
                  )}
                  {!last && <span className={`my-1 w-0.5 flex-1 rounded ${done ? "bg-emerald-500/50" : "bg-border"}`} />}
                </div>
                <div className={`flex flex-1 items-center gap-2 ${last ? "pb-0.5" : "pb-4"}`}>
                  <Link
                    href={t.href}
                    className={`flex-1 text-sm ${done ? "text-muted-foreground line-through" : "font-medium text-foreground hover:text-primary"}`}
                  >
                    {t.label}
                  </Link>
                  {t.auto && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                      auto
                    </span>
                  )}
                  {!done && !t.auto && <ArrowRight className="h-3.5 w-3.5 flex-none text-muted-foreground/40" />}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-1 border-t pt-3 text-xs text-muted-foreground">
          {tasks.length - doneCount} to go — you're all set once these are done.
        </div>
      </CardContent>
    </Card>
  );
}
