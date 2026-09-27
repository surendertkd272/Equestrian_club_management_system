import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { bookingBlockReason, levelLadder, suggestedLevel } from "@/lib/exam-booking";
import { NewExamDayForm } from "./form";
import { examinerLabel } from "@/lib/examiner-label";

export const dynamic = "force-dynamic";

// Book one exam day: every rider sitting that date, each at their own level,
// with an examiner pool per level. The server creates one sitting per level.
export default async function NewExamDayPage() {
  const session = await requireSession();
  if (!can(session.role, "exam.schedule")) redirect("/exams");
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Schedule an exam day</CardTitle>
          <CardDescription>
            An exam day belongs to one centre. Pick the centre in the top bar (not “All centres”), then come back.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if ((await getOrgIdForCentre(centreId)) !== orgId) redirect("/exams");

  const [riders, examiners, ladder] = await Promise.all([
    prisma.rider.findMany({
      where: { centreId, status: { not: "withdrawn" } },
      select: {
        id: true, firstName: true, lastName: true, currentLevel: true, status: true,
        school: true, schoolRef: { select: { name: true } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.user.findMany({
      // Visiting examiners whose access has ended are not offered.
      where: {
        centreId, role: "EXAMINER", status: "active",
        OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }],
      },
      select: { id: true, name: true, accessExpiresAt: true, mustChangePassword: true },
      orderBy: { name: "asc" },
    }),
    levelLadder(prisma, centreId),
  ]);
  const levels = Array.from(ladder.byRank.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rank, t]) => ({ rank, name: t.levelName }));

  if (levels.length === 0) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Schedule an exam day</CardTitle>
          <CardDescription>
            This centre has no scoring rubrics yet, so there are no levels to book.{" "}
            <Link href="/exams/templates" className="text-primary underline">Set up the level rubrics</Link> first.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Schedule an exam day</CardTitle>
          <CardDescription>
            Everyone sitting on one date, each at their own level. Each level becomes its own sitting with its own
            examiner pool; on the day, examiners pick riders from their level&rsquo;s queue. The whole day can then be
            followed, moved or cancelled from one page. Judges coming in from outside?{" "}
            <Link href="/exams/examiners" className="text-primary underline">Register visiting examiners</Link> first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewExamDayForm
            levels={levels}
            examiners={examiners.map((u) => ({ id: u.id, name: examinerLabel(u) }))}
            riders={riders.map((r) => ({
              id: r.id,
              name: `${r.firstName} ${r.lastName}`,
              school: r.schoolRef?.name ?? r.school ?? "",
              currentLevel: r.currentLevel,
              suggested: suggestedLevel(ladder, r.currentLevel),
              blocked: bookingBlockReason(r.status),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
