import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewSittingForm } from "./form";
import { bookingBlockReason } from "@/lib/exam-booking";
import { examinerLabel } from "@/lib/examiner-label";

export const dynamic = "force-dynamic";

export default async function NewSittingPage() {
  const session = await requireSession();
  if (!can(session.role, "exam.schedule")) redirect("/exams");
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const [riders, examiners, templates] = await Promise.all([
    prisma.rider.findMany({
      // Every rider who hasn't left — the ones who can't be booked yet are
      // listed separately WITH the reason, instead of silently missing (a
      // bulk-imported roster waiting for consent used to vanish from here).
      where: { ...tenantWhere(centreId, orgId), status: { not: "withdrawn" } },
      select: { id: true, firstName: true, lastName: true, currentLevel: true, status: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.user.findMany({
      where: {
        ...tenantWhere(centreId, orgId),
        // Only EXAMINERs may be in the pool — they're the ones who score riders.
        role: "EXAMINER",
        status: "active",
        OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }],
      },
      select: { id: true, name: true, role: true, accessExpiresAt: true, mustChangePassword: true },
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
          <CardTitle>Schedule a single sitting</CardTitle>
          <CardDescription>
            One date + level. Pick the riders and the examiner pool — we&apos;ll create a
            scheduled exam per rider, unassigned. On the day, any examiner in the pool picks a
            rider to mark (it then locks to them). Re-attempts link automatically. Booking several
            levels on one date? <a href="/exams/days/new" className="text-primary underline">Schedule an exam day</a> instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewSittingForm
            riders={riders.map((r) => ({
              id: r.id,
              label: `${r.firstName} ${r.lastName}${r.currentLevel ? ` · ${r.currentLevel}` : ""}`,
              blocked: bookingBlockReason(r.status),
            }))}
            examiners={examiners.map((u) => ({ id: u.id, role: u.role, name: examinerLabel(u) }))}
            levels={templates.map((t) => ({ key: t.levelKey, name: t.levelName }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
