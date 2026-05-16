import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { SkillChecklist } from "./checklist";

export const dynamic = "force-dynamic";

export default async function RiderProgressPage({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const rider = await prisma.rider.findUnique({
    where: { id: params.id },
    select: { id: true, firstName: true, lastName: true, centreId: true, currentLevel: true },
  });
  if (!rider) notFound();
  if (centreId && rider.centreId !== centreId) notFound();

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

  // Mastery percentage per level (for the header pills)
  const levelStats = levels.map((l) => {
    const total = l.skills.length;
    const mastered = l.skills.filter((s) => statusMap.get(s.id) === "mastered").length;
    return { id: l.id, name: l.name, total, mastered, pct: total ? Math.round((mastered / total) * 100) : 0 };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/riders/${rider.id}`}>
            <ChevronLeft className="h-4 w-4" /> Back to profile
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">
          Progress · {rider.firstName} {rider.lastName}
        </h1>
        <p className="text-sm text-muted-foreground">
          §4.3 · Current level <b>{rider.currentLevel ?? "—"}</b>
        </p>
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

      {levels.map((level) => (
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
