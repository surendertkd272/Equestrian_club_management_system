// Shared status / plan badges for the owner portal. Dark theme.

const TONE: Record<string, string> = {
  green: "bg-emerald-500/20 text-emerald-300",
  blue: "bg-sky-500/20 text-sky-300",
  amber: "bg-amber-500/20 text-amber-300",
  red: "bg-rose-500/20 text-rose-300",
  slate: "bg-slate-500/20 text-slate-300",
  violet: "bg-violet-500/20 text-violet-300",
};

export function PlanBadge({ plan }: { plan: string }) {
  const tone = plan === "enterprise" ? TONE.violet : plan === "pro" ? TONE.blue : TONE.slate;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{plan}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active" ? TONE.green
    : status === "trial" ? TONE.blue
    : status === "past_due" ? TONE.amber
    : status === "suspended" ? TONE.red
    : TONE.slate;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{status}</span>;
}
