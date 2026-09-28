"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClaimButton } from "./claim-button";
import { RemoveExamButton } from "../../exam-actions";

export type SittingRiderRow = {
  id: string;
  name: string;
  school: string;
  state: "completed" | "unassigned" | "marking";
  examinerName: string | null;
  mine: boolean;
  // This viewer's co-judge card on the exam, if they sit on its panel.
  myCard: "todo" | "done" | null;
  passed: boolean | null;
  canRemove: boolean;
};

const FILTERS = [
  ["all", "All"],
  ["unassigned", "Waiting"],
  ["marking", "Being marked"],
  ["completed", "Marked"],
] as const;

// The sitting's rider list with search and a status filter. A 200-rider
// sitting was one long unsearchable table: a judge looking for the child in
// front of them scrolled for it.
export function SittingRidersTable({
  rows,
  inPool,
  isManager,
}: {
  rows: SittingRiderRow[];
  inPool: boolean;
  isManager: boolean;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const counts = useMemo(() => {
    const c = { all: rows.length, unassigned: 0, marking: 0, completed: 0 };
    for (const r of rows) c[r.state]++;
    return c;
  }, [rows]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || r.state === filter) &&
      (!needle || r.name.toLowerCase().includes(needle) || r.school.toLowerCase().includes(needle)),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search rider or school…"
          aria-label="Search riders in this sitting"
          className="min-w-0 flex-1 sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {FILTERS.map(([key, label]) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={filter === key ? "default" : "outline"}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
            >
              {label} ({counts[key]})
            </Button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2">Rider</th>
              <th className="pb-2">Status</th>
              <th className="pb-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr className="border-t">
                <td colSpan={3} className="py-4 text-center text-sm text-muted-foreground">
                  No riders match.
                </td>
              </tr>
            )}
            {shown.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="py-2">
                  <div className="font-medium">{e.name}</div>
                  {e.school && <div className="text-[11px] text-muted-foreground">{e.school}</div>}
                </td>
                <td className="py-2">
                  {e.state === "completed" ? (
                    <Badge variant="success">
                      Marked{e.passed === true ? " · passed" : e.passed === false ? " · not passed" : ""}
                    </Badge>
                  ) : e.state === "unassigned" ? (
                    <Badge variant="outline">Waiting</Badge>
                  ) : (
                    <Badge variant="warning">Marking · {e.examinerName}</Badge>
                  )}
                </td>
                <td className="py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {e.state === "completed" ? (
                      <Link href={`/exams/${e.id}`} className="text-xs text-primary underline">
                        View
                      </Link>
                    ) : e.myCard === "todo" ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/exams/${e.id}`}>Mark my card</Link>
                      </Button>
                    ) : e.myCard === "done" ? (
                      <span className="text-xs text-muted-foreground">Your card is in</span>
                    ) : e.state === "unassigned" ? (
                      inPool ? <ClaimButton examId={e.id} /> : <span className="text-xs text-muted-foreground">—</span>
                    ) : e.mine ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/exams/${e.id}`}>Continue marking</Link>
                      </Button>
                    ) : isManager ? (
                      <Link href={`/exams/${e.id}`} className="text-xs text-primary underline">
                        Open
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">Locked · {e.examinerName}</span>
                    )}
                    {e.canRemove && <RemoveExamButton examId={e.id} riderName={e.name} inSitting compact />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
