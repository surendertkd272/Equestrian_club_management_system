import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewSittingForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewSittingPage() {
  const session = (await getSession())!;
  if (!can(session.role, "exam.schedule")) redirect("/exams");
  const centreId = scopeCentre(session);

  const [riders, examiners, templates] = await Promise.all([
    prisma.rider.findMany({
      where: { ...(centreId ? { centreId } : {}), status: "active" },
      select: { id: true, firstName: true, lastName: true, currentLevel: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.user.findMany({
      where: {
        ...(centreId ? { centreId } : {}),
        role: { in: ["EXAMINER", "SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH"] as any },
        status: "active",
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.scoringTemplate.findMany({
      where: centreId ? { centreId } : undefined,
      select: { levelKey: true, levelName: true },
      orderBy: { levelKey: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Schedule exams</CardTitle>
          <CardDescription>
            One date + level. Pick the riders and the examiner pool — we&apos;ll create a
            scheduled exam per rider, unassigned. On the day, any examiner in the pool picks a
            rider to mark (it then locks to them). Re-attempts link automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewSittingForm
            riders={riders.map((r) => ({
              id: r.id,
              label: `${r.firstName} ${r.lastName}${r.currentLevel ? ` · ${r.currentLevel}` : ""}`,
            }))}
            examiners={examiners}
            levels={templates.map((t) => ({ key: t.levelKey, name: t.levelName }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
