import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { formatEnum } from "@/lib/labels";
import { schoolContext } from "@/lib/school-portal";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { NoCentreCard } from "../no-centre";

export const dynamic = "force-dynamic";

// Exam results, and a leaderboard per level.
//
// THE PRIVACY PROBLEM, and how this solves it. A leaderboard is comparative by
// nature, but naming every child at the club would undo the school fence
// entirely — a fenced administrator would learn the names and scores of other
// schools' pupils just by opening this page.
//
// So the board lists only this school's riders, and each one carries their
// TRUE rank within the whole centre cohort at that level ("2nd of 14"). The
// comparison stays honest — the rank is computed against every exam sat at the
// club — while the other children stay anonymous. An unfenced administrator
// (one centre, one school) sees the same thing, which for them is simply the
// whole club.

type Sat = {
  id: string;
  riderId: string;
  level: number;
  totalScore: number | null;
  passed: boolean | null;
  status: string;
  date: Date;
  attemptNumber: number;
  rider: { firstName: string; lastName: string };
};

export default async function SchoolExamsPage() {
  const ctx = await schoolContext();
  if (!ctx) return <NoCentreCard />;

  const [mine, cohort, upcoming] = await Promise.all([
    // This school's completed, scored exams.
    prisma.exam.findMany({
      where: {
        rider: ctx.riderWhere,
        status: "completed",
        totalScore: { not: null },
      },
      orderBy: [{ level: "asc" }, { totalScore: "desc" }],
      select: {
        id: true,
        riderId: true,
        level: true,
        totalScore: true,
        passed: true,
        status: true,
        date: true,
        attemptNumber: true,
        rider: { select: { firstName: true, lastName: true } },
      },
    }),
    // Every scored exam at the CENTRE, for ranking only. Scores and levels
    // only — no names, no rider ids leave this query into the page.
    prisma.exam.findMany({
      where: { centreId: ctx.centreId, status: "completed", totalScore: { not: null } },
      select: { level: true, totalScore: true },
    }),
    prisma.exam.findMany({
      where: { rider: ctx.riderWhere, status: { in: ["scheduled", "in_progress"] } },
      orderBy: { date: "asc" },
      take: 20,
      select: {
        id: true,
        level: true,
        date: true,
        status: true,
        rider: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  // Scores per level across the whole club, sorted high to low, so a rank is a
  // lookup rather than a second query per rider.
  const cohortByLevel = new Map<number, number[]>();
  for (const e of cohort) {
    const arr = cohortByLevel.get(e.level) ?? [];
    arr.push(e.totalScore!);
    cohortByLevel.set(e.level, arr);
  }
  for (const arr of cohortByLevel.values()) arr.sort((a, b) => b - a);

  /** Standard competition ranking: equal scores share a place. */
  function rankOf(level: number, score: number): { rank: number; outOf: number } {
    const arr = cohortByLevel.get(level) ?? [];
    return { rank: arr.filter((s) => s > score).length + 1, outOf: arr.length };
  }

  const byLevel = new Map<number, Sat[]>();
  for (const e of mine as Sat[]) {
    const arr = byLevel.get(e.level) ?? [];
    arr.push(e);
    byLevel.set(e.level, arr);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  const passed = mine.filter((e) => e.passed === true).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Exams &amp; Leaderboard</h1>
        <p className="text-sm text-muted-foreground">
          {mine.length} result{mine.length === 1 ? "" : "s"} · {passed} passed · {ctx.title}
        </p>
      </div>

      {upcoming.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coming Up ({upcoming.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {upcoming.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between border-b py-1.5 text-sm last:border-0"
                >
                  <span>
                    <span className="font-medium">
                      {e.rider.firstName} {e.rider.lastName}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">Level {e.level}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{formatDate(e.date)}</span>
                    <Badge variant="warning">{formatEnum(e.status)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {levels.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No Results Yet</CardTitle>
            <CardDescription>
              Leaderboards appear here once your students have sat and been scored on an exam.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        levels.map((level) => {
          const rows = byLevel.get(level)!;
          const cohortSize = (cohortByLevel.get(level) ?? []).length;
          return (
            <Card key={level}>
              <CardHeader>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <CardTitle className="text-base">Level {level}</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {rows.length} of yours · ranked against {cohortSize} sat at the club
                  </span>
                </div>
                <CardDescription>
                  Highest score first. Club rank counts every rider who sat this level at{" "}
                  {ctx.centreName}, so the placing is real even though only your own students are
                  named.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveTable
                  rows={rows}
                  getRowKey={(e) => e.id}
                  columns={[
                    {
                      key: "rider",
                      header: "Rider",
                      primary: true,
                      cell: (e) => (
                        <span className="font-medium">
                          {e.rider.firstName} {e.rider.lastName}
                        </span>
                      ),
                    },
                    {
                      key: "score",
                      header: "Score",
                      numeric: true,
                      cell: (e) => <span className="font-medium">{e.totalScore!.toFixed(1)}</span>,
                    },
                    {
                      key: "rank",
                      header: "Club Rank",
                      numeric: true,
                      cell: (e) => {
                        const { rank, outOf } = rankOf(e.level, e.totalScore!);
                        const label = `${ordinal(rank)} of ${outOf}`;
                        return rank <= 3 ? (
                          <Badge variant="success">{label}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{label}</span>
                        );
                      },
                    },
                    {
                      key: "attempt",
                      header: "Attempt",
                      hideOnMobile: true,
                      cell: (e) => (
                        <span className="text-xs text-muted-foreground">
                          {e.attemptNumber > 1 ? `Attempt ${e.attemptNumber}` : "First"}
                        </span>
                      ),
                    },
                    {
                      key: "date",
                      header: "Date",
                      cell: (e) => (
                        <span className="text-xs text-muted-foreground">{formatDate(e.date)}</span>
                      ),
                    },
                    {
                      key: "result",
                      header: "Result",
                      headerClassName: "text-right",
                      cell: (e) =>
                        e.passed === true ? (
                          <Badge variant="success">Passed</Badge>
                        ) : e.passed === false ? (
                          <Badge variant="destructive">Not yet</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        ),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
