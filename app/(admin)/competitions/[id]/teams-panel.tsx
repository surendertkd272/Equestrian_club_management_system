"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDisciplineRules } from "@/lib/discipline";

type Entry = {
  id: string;
  riderName: string;
  className: string;
  teamId: string | null;
  score: number | null;
  faults: number | null;
  time: number | null;
};

// Computes a per-team rollup from entries that have a teamId. Strategy:
//   • Aggregate scores by team using the discipline's primary ranking
//     channel (score / faults / time), but combine per team:
//       - dressage / generic: average percentage / score across riders
//       - jumping / eventing: sum of faults, total time
//       - gymkhana: total time, sum of penalty faults
// Only the top N rides per team count (PRD convention — drop-the-worst),
// but for now we average / sum all submitted scores. Easy to swap later.
export function TeamsPanel({
  competitionId,
  canManage,
  discipline,
  teams,
  entries,
}: {
  competitionId: string;
  canManage: boolean;
  discipline: string;
  teams: { id: string; name: string }[];
  entries: Entry[];
}) {
  const rules = getDisciplineRules(discipline);
  const byTeam = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!e.teamId) continue;
    if (!byTeam.has(e.teamId)) byTeam.set(e.teamId, []);
    byTeam.get(e.teamId)!.push(e);
  }

  function aggregate(es: Entry[]) {
    const validScores = es.map((e) => e.score).filter((v): v is number => typeof v === "number");
    const sumFaults = es.reduce((s, e) => s + (typeof e.faults === "number" ? e.faults : 0), 0);
    const sumTime = es.reduce((s, e) => s + (typeof e.time === "number" ? e.time : 0), 0);
    const avgScore = validScores.length > 0 ? validScores.reduce((a, b) => a + b, 0) / validScores.length : null;
    return { avgScore, sumFaults, sumTime, count: es.length };
  }

  // Order teams by the discipline's primary ranking metric.
  const ranked = teams
    .map((t) => ({ t, es: byTeam.get(t.id) ?? [] }))
    .filter((r) => r.es.length > 0)
    .map((r) => ({ ...r, agg: aggregate(r.es) }))
    .sort((a, b) => {
      if (discipline === "dressage" || discipline === "generic") {
        const av = a.agg.avgScore ?? Number.NEGATIVE_INFINITY;
        const bv = b.agg.avgScore ?? Number.NEGATIVE_INFINITY;
        return bv - av;
      }
      // Faults-first disciplines: fewer faults wins, then fastest time.
      if (a.agg.sumFaults !== b.agg.sumFaults) return a.agg.sumFaults - b.agg.sumFaults;
      return a.agg.sumTime - b.agg.sumTime;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Team standings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No team entries yet. Set a Team on a rider&apos;s entry to count toward team standings.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-2">#</th>
                <th className="pb-2">Team</th>
                <th className="pb-2">Riders</th>
                <th className="pb-2">{rules.primaryColumn}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const headline =
                  discipline === "dressage" || discipline === "generic"
                    ? r.agg.avgScore !== null
                      ? r.agg.avgScore.toFixed(2)
                      : "—"
                    : `${r.agg.sumFaults} faults · ${r.agg.sumTime.toFixed(2)}s`;
                return (
                  <tr key={r.t.id} className="border-t">
                    <td className="py-2">
                      <Badge variant={i === 0 ? "success" : i <= 2 ? "warning" : "outline"}>
                        {i + 1}
                      </Badge>
                    </td>
                    <td className="py-2 font-medium">{r.t.name}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {r.es.slice(0, 4).map((e) => e.riderName).join(", ")}
                      {r.es.length > 4 && ` +${r.es.length - 4}`}
                    </td>
                    <td className="py-2 font-mono">{headline}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
