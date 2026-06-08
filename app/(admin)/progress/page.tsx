import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: { batch?: string; level?: string };
}) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const riderWhere: any = { ...centreWhere(centreId), status: "active" };
  if (searchParams.batch) riderWhere.batchId = searchParams.batch;
  // Level filter — narrows the rider list to those currently at the
  // picked level. Drives the mastery heatmap which gets harder to
  // skim on large rosters; a coach can focus on 'who's at L2'.
  if (searchParams.level) riderWhere.currentLevel = searchParams.level;

  // For coaches, default to only their assigned batches' riders unless they pick "all".
  const batchWhere: any = { ...centreWhere(centreId) };
  if (session.role === "COACH") batchWhere.coachId = session.userId;
  const batches = await prisma.batch.findMany({
    where: batchWhere,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (session.role === "COACH" && batches.length > 0 && !searchParams.batch) {
    riderWhere.batchId = { in: batches.map((b) => b.id) };
  }

  const [riders, levels, allSkills, allStatuses] = await Promise.all([
    prisma.rider.findMany({
      where: riderWhere,
      select: { id: true, firstName: true, lastName: true, currentLevel: true, batchId: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 200,
    }),
    prisma.progressLevel.findMany({
      where: centreWhere(centreId),
      include: { skills: { select: { id: true, discipline: true, levelId: true } } },
      orderBy: { order: "asc" },
    }),
    prisma.skill.findMany({
      where: { level: centreId ? { centreId } : undefined },
      select: { id: true, discipline: true, levelId: true },
    }),
    prisma.riderSkillStatus.findMany({
      where: { rider: centreId ? { centreId } : undefined },
      select: { riderId: true, skillId: true, status: true },
    }),
  ]);

  // Build per-rider per-category mastery%. "Category" is the value of
  // Skill.discipline — historically a hard-coded enum (normal/dressage/…)
  // but now driven by the rubric's section names (Dress Code / Know Your
  // Horse / Parts of Tack / Riding Knowledge / Overall Judgement). We
  // derive the active set from the data so this page works regardless of
  // how a centre's catalog is configured.
  const skillById = new Map(allSkills.map((s) => [s.id, s]));
  const activeDisciplines = Array.from(new Set(allSkills.map((s) => s.discipline))).sort();

  type Cell = { mastered: number; total: number };
  const matrix = new Map<string, Map<string, Cell>>(); // riderId → category → cell
  for (const r of riders) {
    const inner = new Map<string, Cell>();
    for (const d of activeDisciplines) inner.set(d, { mastered: 0, total: 0 });
    matrix.set(r.id, inner);
  }
  for (const skill of allSkills) {
    for (const r of riders) {
      const cell = matrix.get(r.id)?.get(skill.discipline);
      if (cell) cell.total += 1;
    }
  }
  for (const st of allStatuses) {
    const skill = skillById.get(st.skillId);
    if (!skill) continue;
    if (st.status !== "mastered") continue;
    const cell = matrix.get(st.riderId)?.get(skill.discipline);
    if (cell) cell.mastered += 1;
  }

  // Overall mastery (across all categories) for each rider
  const overall = new Map<string, number>();
  for (const [riderId, inner] of matrix.entries()) {
    let m = 0;
    let t = 0;
    for (const c of inner.values()) {
      m += c.mastered;
      t += c.total;
    }
    overall.set(riderId, t > 0 ? Math.round((m / t) * 100) : 0);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Progress Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          {riders.length} active riders · per-discipline mastery heatmap. Click a rider to drill in.
        </p>
      </div>

      <Card>
        <CardHeader>
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Batch</label>
              <select aria-label="Filter by batch"
                name="batch"
                defaultValue={searchParams.batch ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{session.role === "COACH" ? "My batches" : "All"}</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Level</label>
              <select aria-label="Filter by level"
                name="level"
                defaultValue={searchParams.level ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All levels</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="inline-flex h-9 items-center rounded-md border bg-card px-3 text-sm hover:bg-muted">
              Filter
            </button>
          </form>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-muted-foreground">
                  <th className="pb-2 text-left">Rider</th>
                  <th className="pb-2 text-left">Level</th>
                  {activeDisciplines.map((d) => (
                    <th key={d} className="pb-2 text-center">
                      {d.replaceAll("_", " ")}
                    </th>
                  ))}
                  <th className="pb-2 text-right">Overall</th>
                </tr>
              </thead>
              <tbody>
                {riders.map((r) => {
                  const o = overall.get(r.id) ?? 0;
                  return (
                    <tr key={r.id} className="border-t hover:bg-muted/40">
                      <td className="py-2">
                        <Link href={`/riders/${r.id}/progress`} className="font-medium hover:underline">
                          {r.firstName} {r.lastName}
                        </Link>
                      </td>
                      <td className="py-2">
                        <Badge variant="outline">{r.currentLevel ?? "—"}</Badge>
                      </td>
                      {activeDisciplines.map((d) => {
                        const cell = matrix.get(r.id)?.get(d) ?? { mastered: 0, total: 0 };
                        const pct = cell.total > 0 ? Math.round((cell.mastered / cell.total) * 100) : null;
                        return (
                          <td key={d} className="py-1 text-center">
                            {pct === null ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={
                                      pct >= 80
                                        ? "h-full bg-emerald-500"
                                        : pct >= 50
                                        ? "h-full bg-amber-500"
                                        : pct > 0
                                        ? "h-full bg-primary/40"
                                        : "h-full"
                                    }
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground">
                                  {cell.mastered}/{cell.total}
                                </span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-2 text-right">
                        <Badge variant={o >= 80 ? "success" : o >= 50 ? "warning" : "outline"}>{o}%</Badge>
                      </td>
                    </tr>
                  );
                })}
                {riders.length === 0 && (
                  <tr>
                    <td colSpan={activeDisciplines.length + 3} className="py-12 text-center text-muted-foreground">
                      No active riders in this scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
