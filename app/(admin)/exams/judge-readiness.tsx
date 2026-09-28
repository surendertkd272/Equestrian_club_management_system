import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { JudgeReadiness } from "@/lib/examiner-readiness";

export type JudgeRow = { id: string; name: string; readiness: JudgeReadiness; you?: boolean; panel?: boolean };

// The judges on a sitting or exam day, each with whether they can mark.
export function JudgeBadges({ judges }: { judges: JudgeRow[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {judges.map((j) => (
        <Badge key={`${j.id}-${j.panel ? "p" : "x"}`} variant={j.readiness.ok ? (j.you ? "success" : "outline") : j.readiness.tone}>
          {j.name}
          {j.you ? " (you)" : ""}
          {j.panel ? " · panel" : ""}
          {!j.readiness.ok ? ` · ${j.readiness.label}` : ""}
        </Badge>
      ))}
    </div>
  );
}

// One line naming every judge who can't mark yet, for the top of the page.
export function JudgeReadinessBanner({ judges, canManage }: { judges: JudgeRow[]; canManage: boolean }) {
  const notReady = Array.from(new Map(judges.filter((j) => !j.readiness.ok).map((j) => [j.id, j])).values());
  if (notReady.length === 0) return null;
  return (
    <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm" role="status">
      <span className="font-medium">
        {notReady.length} judge{notReady.length === 1 ? " can't" : "s can't"} mark yet:
      </span>{" "}
      {notReady.map((j) => `${j.name} (${j.readiness.label})`).join(", ")}.{" "}
      {notReady.some((j) => j.readiness.label === "hasn't signed in yet") &&
        "They must sign in once with their temporary password and set their own. "}
      {canManage && (
        <Link href="/exams/examiners" className="text-primary underline">
          Examiners →
        </Link>
      )}
    </div>
  );
}
