import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewSittingForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewSittingPage() {
  const session = await requireSession();
  if (!can(session.role, "exam.schedule")) redirect("/exams");
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const [riders, examiners, templates] = await Promise.all([
    prisma.rider.findMany({
      where: { ...tenantWhere(centreId, orgId), status: "active" },
      select: { id: true, firstName: true, lastName: true, currentLevel: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.user.findMany({
      where: {
        ...tenantWhere(centreId, orgId),
        // Only EXAMINERs may be in the pool — they're the ones who score riders.
        role: "EXAMINER",
        status: "active",
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.scoringTemplate.findMany({
      where: tenantWhere(centreId, orgId),
      select: { levelKey: true, levelName: true },
      orderBy: { levelKey: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Schedule Exams</CardTitle>
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
