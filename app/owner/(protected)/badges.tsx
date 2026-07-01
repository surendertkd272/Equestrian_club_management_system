// Shared status / plan badges for the owner portal. Dark theme.

import { formatEnum } from "@/lib/labels";
const TONE: Record<string, string> = {
  green: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  blue: "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300",
  amber: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300",
  red: "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300",
  slate: "bg-muted text-foreground",
  violet: "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300",
};

export function PlanBadge({ plan }: { plan: string }) {
  const tone = plan === "enterprise" ? TONE.violet : plan === "pro" ? TONE.blue : TONE.slate;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${tone}`}>{formatEnum(plan)}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active" ? TONE.green
    : status === "trial" ? TONE.blue
    : status === "past_due" ? TONE.amber
    : status === "suspended" ? TONE.red
    : TONE.slate;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${tone}`}>{formatEnum(status)}</span>;
}
