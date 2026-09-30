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
export default async function NewExamDayPage({ searchParams }: { searchParams: { resit?: string } }) {
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
        id: true, firstName: true, lastName: true, currentLevel: true, status: true, schoolClass: true, examReadyLevel: true,
        school: true, schoolRef: { select: { name: true } }, batch: { select: { name: true } },
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
  // Re-sits: a rider whose latest exam was not passed, or who was absent,
  // and who isn't booked again yet. Coach nominations take precedence.
  const [lastExams, openBookings] = await Promise.all([
    prisma.exam.findMany({
      where: { centreId, OR: [{ status: "absent" }, { status: "completed", passed: false }, { status: "completed", passed: true }] },
      orderBy: { date: "desc" },
      select: { riderId: true, level: true, status: true, passed: true, sitting: { select: { examDayId: true } } },
    }),
    prisma.exam.findMany({ where: { centreId, status: { in: ["scheduled", "in_progress"] } }, select: { riderId: true } }),
  ]);
  const booked = new Set(openBookings.map((e) => e.riderId));
  const latest = new Map<string, (typeof lastExams)[number]>();
  for (const e of lastExams) if (!latest.has(e.riderId)) latest.set(e.riderId, e);
  const resitOf = (riderId: string) => {
    const e = latest.get(riderId);
    return e && !booked.has(riderId) && (e.status === "absent" || e.passed === false) ? e.level : null;
  };
  // "Book re-sits" from a finished day pre-fills its riders who didn't pass or were absent.
  const initialAssign: Record<string, number> = {};
  if (searchParams.resit) {
    for (const e of lastExams) {
      if (e.sitting?.examDayId === searchParams.resit && resitOf(e.riderId) === e.level) initialAssign[e.riderId] = e.level;
    }
  }
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
            <Link href="/exams/examiners" className="text-primary underline">Register visiting examiners</Link> first. Returning riders still showing no level?{" "}
            <Link href="/riders/levels" className="text-primary underline">Set their levels</Link> so each is offered the right next level.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewExamDayForm
            levels={levels}
            examiners={examiners.map((u) => ({ id: u.id, name: examinerLabel(u) }))}
            initialAssign={initialAssign}
            riders={riders.map((r) => {
              const resit = resitOf(r.id);
              const nominated = r.examReadyLevel && ladder.byRank.has(r.examReadyLevel) ? r.examReadyLevel : null;
              return {
                id: r.id,
                name: `${r.firstName} ${r.lastName}`,
                school: r.schoolRef?.name ?? r.school ?? "",
                schoolClass: r.schoolClass ?? "",
                batch: r.batch?.name ?? "",
                currentLevel: r.currentLevel,
                suggested: nominated ?? resit ?? suggestedLevel(ladder, r.currentLevel),
                resit,
                nominated,
                blocked: bookingBlockReason(r.status),
              };
            })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
