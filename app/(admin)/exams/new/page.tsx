import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewExamForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewExamPage({
  searchParams,
}: {
  searchParams: { riderId?: string };
}) {
  const session = (await getSession())!;
  if (!can(session.role, "exam.schedule")) redirect("/exams");

  const centreId = scopeCentre(session);
  const where = centreWhere(centreId);
  // ?riderId=… lets the rider detail page deep-link "Register for exam"
  // with the right rider already selected.
  const preselectRiderId = searchParams.riderId ?? null;

  const [riders, examiners, templates, catalog] = await Promise.all([
    prisma.rider.findMany({
      where: { ...where, status: "active" },
      select: { id: true, firstName: true, lastName: true, currentLevel: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.user.findMany({
      where: {
        ...where,
        role: { in: ["EXAMINER", "JURY", "CENTRE_MANAGER", "COACH", "HEAD_COACH"] },
        status: "active",
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.scoringTemplate.findMany({
      where,
      select: { levelKey: true, levelName: true },
      orderBy: { levelKey: "asc" },
    }),
    // Pull the canonical catalog too so the scheduling form can show
    // discipline → level pickers with proper names ("Dressage · Stage 2 —
    // Foundation") instead of the bare "L2" used historically. The form
    // still falls back to centre templates if the catalog is empty.
    prisma.examLevel.findMany({
      where: { active: true },
      orderBy: [{ discipline: "asc" }, { orderIndex: "asc" }],
      select: { id: true, discipline: true, code: true, name: true, orderIndex: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Schedule exam</CardTitle>
          <CardDescription>
            Pick a rider, an examiner, a level (must have a scoring template), and a date/time. After scheduling, the
            examiner will see the exam on their dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scoring templates yet. Ask a Super Admin to create one in <code>/exams/templates</code>.
            </p>
          ) : riders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active riders. Onboard one first.</p>
          ) : examiners.length === 0 ? (
            <p className="text-sm text-muted-foreground">No examiners. Add staff with role EXAMINER, COACH, or CENTRE_MANAGER.</p>
          ) : (
            <NewExamForm
              riders={riders}
              examiners={examiners}
              templates={templates}
              catalog={catalog}
              preselectRiderId={preselectRiderId}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
