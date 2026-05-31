"use client";

// Reusable past-exams list with expandable per-exam category breakdown.
// Used by /student, /parent/[id], and the staff rider profile.
//
// The header row shows: date · level · total/max · pass/fail badge ·
// chevron. Click toggles inline category breakdown — every section from
// the rubric with its items + saved scores (or "—" if not entered).
// Sub-items (Level 3 Small Jumps / Level 4 Gallop Run / Tent Pegging)
// render as nested rows under the parent label.

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { RubricCategory, RubricItem } from "@/lib/schemas/exam";

export type ExamRow = {
  id: string;
  date: Date | string;
  level: number;
  examinerName: string | null;
  totalScore: number | null;
  passed: boolean | null;
  scoresJson: Record<string, number | string> | null;
  rubric: RubricCategory[];
  passThreshold: number;
};

export function ExamHistoryList({ exams }: { exams: ExamRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (exams.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No completed exams yet.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {exams.map((exam) => {
        const isOpen = openId === exam.id;
        const max = rubricMax(exam.rubric);
        const score = exam.totalScore ?? 0;
        return (
          <li key={exam.id} className="overflow-hidden rounded-md border bg-card">
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : exam.id)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40"
            >
              <div className="flex items-center gap-3 text-sm">
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="font-medium">Level {exam.level}</span>
                <span className="text-muted-foreground">
                  {formatDate(exam.date)}
                </span>
                {exam.examinerName && (
                  <span className="text-xs text-muted-foreground">
                    · {exam.examinerName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono">
                  {score}
                  {max > 0 ? `/${max}` : ""}
                </span>
                {exam.passed === true && (
                  <Badge variant="success">Pass</Badge>
                )}
                {exam.passed === false && (
                  <Badge variant="destructive">Fail</Badge>
                )}
                {exam.passed === null && (
                  <Badge variant="outline">—</Badge>
                )}
              </div>
            </button>
            {isOpen && (
              <div className="border-t bg-muted/20 px-3 py-3">
                {exam.rubric.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Rubric for this level isn't available right now (it may have
                    been edited or removed since the exam was scored).
                  </p>
                ) : (
                  <ExamScoreBreakdown
                    rubric={exam.rubric}
                    scores={exam.scoresJson ?? {}}
                    passThreshold={exam.passThreshold}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ExamScoreBreakdown({
  rubric,
  scores,
  passThreshold,
}: {
  rubric: RubricCategory[];
  scores: Record<string, number | string>;
  passThreshold: number;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground">
        Pass mark: <span className="font-mono">{passThreshold}%</span>
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {rubric.map((cat) => {
          const { score, max } = sumCategory(cat, scores);
          return (
            <div
              key={cat.name}
              className="overflow-hidden rounded-md border bg-card"
            >
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide">
                  {cat.name}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {score}/{max}
                </span>
              </div>
              <ul className="divide-y text-xs">
                {cat.items.map((item, idx) => {
                  const hasSubs =
                    Array.isArray(item.subitems) && item.subitems.length > 0;
                  if (hasSubs) {
                    return (
                      <li key={`${item.name}-${idx}`} className="px-3 py-2">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="font-medium">{item.name}</span>
                          <span className="font-mono text-[10px] italic text-muted-foreground">
                            (sum)
                          </span>
                        </div>
                        <ul className="ml-3 space-y-1 border-l pl-2.5">
                          {item.subitems!.map((sub, sidx) => {
                            const key = `${cat.name}_${item.name}_${sub.name}`;
                            const v = scores[key];
                            return (
                              <li
                                key={`${sub.name}-${sidx}`}
                                className="flex justify-between gap-2 text-muted-foreground"
                              >
                                <span>{sub.name}</span>
                                <span className="font-mono text-[10px]">
                                  {fmtScore(v, sub.max_score ?? 0)}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  }
                  const key = `${cat.name}_${item.name}`;
                  const v = scores[key];
                  return (
                    <li
                      key={`${item.name}-${idx}`}
                      className="flex justify-between gap-2 px-3 py-1.5"
                    >
                      <span>{item.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {fmtScore(v, item.max_score ?? 0)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Sum the score + max for a category, walking leaf items + sub-items.
function sumCategory(
  cat: RubricCategory,
  scores: Record<string, number | string>,
): { score: number; max: number } {
  let score = 0;
  let max = 0;
  for (const item of cat.items) {
    if (Array.isArray(item.subitems) && item.subitems.length > 0) {
      for (const sub of item.subitems) {
        max += sub.max_score ?? 0;
        const v = scores[`${cat.name}_${item.name}_${sub.name}`];
        if (typeof v === "number") score += v;
      }
    } else {
      max += item.max_score ?? 0;
      const v = scores[`${cat.name}_${item.name}`];
      if (typeof v === "number") score += v;
    }
  }
  return { score, max };
}

function rubricMax(rubric: RubricCategory[]): number {
  return rubric.reduce((s, c) => s + sumCategory(c, {}).max, 0);
}

function fmtScore(v: number | string | undefined, max: number): string {
  if (v === undefined) return "—";
  if (typeof v === "number") return `${v}/${max}`;
  return String(v);
}

// Avoid unused-type warnings on RubricItem — we use the type indirectly
// via cat.items typing.
export type _Reference = RubricItem;
