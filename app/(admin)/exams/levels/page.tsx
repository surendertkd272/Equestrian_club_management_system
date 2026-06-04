import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft } from "lucide-react";
import { LevelsManager } from "./levels-manager";

export const dynamic = "force-dynamic";

export default async function ExamLevelsPage() {
  const session = (await getSession())!;
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/exams");

  const [levels, templateCounts] = await Promise.all([
    // Discipline is no longer surfaced in this catalog — every row shown
    // belongs to the 'general' Equiwings ladder. Other discipline rows
    // from the old seed stay in the DB but aren't relevant here.
    prisma.examLevel.findMany({
      where: { discipline: "general" },
      orderBy: { orderIndex: "asc" },
    }),
    // Per-level count of centres that have customised a rubric. Lets HQ see
    // which levels are widely adopted vs orphaned.
    prisma.scoringTemplate.groupBy({
      by: ["examLevelId"],
      _count: { _all: true },
    }),
  ]);
  const adoption = new Map<string, number>();
  for (const t of templateCounts) if (t.examLevelId) adoption.set(t.examLevelId, t._count._all);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/exams">
            <ChevronLeft className="h-4 w-4" /> Back to exams
          </Link>
        </Button>
        <Badge variant="outline">HQ only · {levels.length} levels</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Exam Levels Catalog</CardTitle>
          <CardDescription>
            Master list of progression levels. Centres pick from this list when adding a scoring
            rubric, so every club shows the same level names instead of inventing their own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LevelsManager
            initial={levels.map((l) => ({
              id: l.id,
              discipline: l.discipline,
              orderIndex: l.orderIndex,
              code: l.code,
              name: l.name,
              passThreshold: l.passThreshold,
              description: l.description,
              minExaminerLevel: l.minExaminerLevel,
              active: l.active,
              adoptedBy: adoption.get(l.id) ?? 0,
              // Surface the rubric content so the manager can render
              // the categories + items inline (expandable per row).
              rubric: l.defaultRubricJson as unknown,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
