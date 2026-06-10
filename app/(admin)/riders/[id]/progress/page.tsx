import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { SkillChecklist } from "./checklist";

export const dynamic = "force-dynamic";

export default async function RiderProgressPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { level?: string };
}) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) notFound();

  const rider = await prisma.rider.findUnique({
    where: { id: params.id },
    select: { id: true, firstName: true, lastName: true, centreId: true, currentLevel: true },
  });
  if (!rider) notFound();
  if (centreId && rider.centreId !== centreId) notFound();
  // HQ users (centreId=null) bypass the centre check above — bound them by org
  // so they can't open another org's rider by id.
  if ((await getOrgIdForCentre(rider.centreId)) !== orgId) notFound();

  const [levels, statuses] = await Promise.all([
    prisma.progressLevel.findMany({
      where: { centreId: rider.centreId },
      orderBy: { order: "asc" },
      include: { skills: { orderBy: [{ discipline: "asc" }, { name: "asc" }] } },
    }),
    prisma.riderSkillStatus.findMany({ where: { riderId: rider.id } }),
  ]);

  const statusMap = new Map(statuses.map((s) => [s.skillId, s.status]));
  const canEdit = can(session.role, "progress.write");

  // Mastery percentage per level (for the header pills). Always computed
  // against the full level set so the summary doesn't change when a filter
  // hides some sections below.
  const levelStats = levels.map((l) => {
    const total = l.skills.length;
    const mastered = l.skills.filter((s) => statusMap.get(s.id) === "mastered").length;
    return { id: l.id, name: l.name, total, mastered, pct: total ? Math.round((mastered / total) * 100) : 0 };
  });

  // Level filter — if the user picked one, only that level's card renders
  // below. The summary tiles above stay full so the rider can see overall
  // progress at a glance. "all" or no param shows everything.
  const selectedLevel = searchParams.level && searchParams.level !== "all" ? searchParams.level : null;
  const visibleLevels = selectedLevel
    ? levels.filter((l) => l.name === selectedLevel)
    : levels;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/riders/${rider.id}`}>
            <ChevronLeft className="h-4 w-4" /> Back to profile
          </Link>
        </Button>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            Progress · {rider.firstName} {rider.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Current level <b>{rider.currentLevel ?? "—"}</b>
          </p>
        </div>
        <form className="flex items-center gap-2">
          <label htmlFor="level-filter" className="text-xs text-muted-foreground">
            Show
          </label>
          <select aria-label="Filter by level"
            id="level-filter"
            name="level"
            defaultValue={selectedLevel ?? "all"}
            className="h-9 rounded-md border bg-card px-2 text-sm"
          >
            <option value="all">All levels</option>
            {levels.map((l) => (
              <option key={l.id} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-9 rounded-md border bg-card px-3 text-xs font-medium hover:bg-muted"
          >
            Apply
          </button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mastery by level</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {levelStats.map((l) => (
              <div key={l.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{l.name}</div>
                  <Badge variant={l.pct >= 80 ? "success" : l.pct >= 50 ? "warning" : "outline"}>
                    {l.pct}%
                  </Badge>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${l.pct >= 80 ? "bg-emerald-500" : l.pct >= 50 ? "bg-amber-500" : "bg-primary/50"}`}
                    style={{ width: `${l.pct}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {l.mastered} of {l.total} skills mastered
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {visibleLevels.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No level matches "{selectedLevel}". Pick a different one from the filter above.
          </CardContent>
        </Card>
      )}
      {visibleLevels.map((level) => (
        <Card key={level.id}>
          <CardHeader>
            <CardTitle>{level.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <SkillChecklist
              riderId={rider.id}
              skills={level.skills.map((s) => ({
                id: s.id,
                name: s.name,
                discipline: s.discipline,
                status: (statusMap.get(s.id) as "not_started" | "in_progress" | "mastered" | undefined) ?? "not_started",
              }))}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
