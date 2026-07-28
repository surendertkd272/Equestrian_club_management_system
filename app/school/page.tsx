// School Administrator dashboard. Read-only roll-up of attendance, exam
// levels, and skill progress for riders attached to this school. The
// "school" linkage today comes from rider.school (free-text field). When
// a more formal School entity lands we'll switch to an FK; for now we
// match by string. The school admin sees only riders whose `school`
// field matches their own (stored on User.name as a convention, or
// passed via a future School table).
//
// Until the formal mapping ships, every SCHOOL_ADMINISTRATOR is centre-
// scoped — they see all riders at their assigned centre. The centre is
// set on their User row at create-time.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { EnrolmentActions } from "@/app/(admin)/enrolments/enrolment-actions";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

export default async function SchoolDashboardPage() {
  const session = await requireSession();
  // Layout already verifies the role; centre scope comes from session.
  const centreId = session.centreId;

  if (!centreId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Club Assigned</CardTitle>
          <CardDescription>
            Your account isn't linked to a club yet. Ask the centre admin to assign you to a centre.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Bind the RLS tenant context before the roll-up queries below (the school
  // admin is centre-scoped, so this resolves org via their centre).
  await getOrgIdForSession(session);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [centre, riders, attendanceSummary, recentExams, recentSkills, pendingEnrolments] = await Promise.all([
    prisma.centre.findUnique({ where: { id: centreId }, select: { name: true } }),
    prisma.rider.findMany({
      where: { centreId, status: { in: ["active", "pending_payment"] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        currentLevel: true,
        joiningDate: true,
        school: true,
      },
      orderBy: { firstName: "asc" },
      take: 200,
    }),
    prisma.attendance.groupBy({
      by: ["riderId"],
      where: {
        date: { gte: monthStart },
        batch: { centreId },
      },
      _count: { _all: true },
    }),
    prisma.exam.findMany({
      where: {
        centreId,
        date: { gte: new Date(Date.now() - 60 * 86400000) },
      },
      orderBy: { date: "desc" },
      take: 30,
    }),
    prisma.riderSkillStatus.findMany({
      where: { rider: { centreId } },
      include: {
        rider: { select: { firstName: true, lastName: true } },
        skill: { select: { name: true, discipline: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.rider.findMany({
      where: { centreId, status: "pending_approval", selfEnrolled: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, firstName: true, lastName: true, mobile: true, school: true, createdAt: true },
    }),
  ]);

  // Index attendance counts by rider id for fast lookup in the table below.
  const attendanceByRider = new Map(attendanceSummary.map((a) => [a.riderId, a._count._all]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{centre?.name ?? "Club"} — school view</h1>
      </div>

      {pendingEnrolments.length > 0 && (
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader>
            <CardTitle>Self-enrolments awaiting your approval ({pendingEnrolments.length})</CardTitle>
            <CardDescription>
              Riders who signed up via the public link. Approve to start their registration, or reject.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Mobile</th>
                    <th className="pb-2">School</th>
                    <th className="pb-2">Signed Up</th>
                    <th className="pb-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingEnrolments.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="py-2 font-medium">{r.firstName} {r.lastName}</td>
                      <td className="py-2">{r.mobile}</td>
                      <td className="py-2 text-xs text-muted-foreground">{r.school ?? "—"}</td>
                      <td className="py-2 text-xs text-muted-foreground">{formatDate(r.createdAt)}</td>
                      <td className="py-2 text-right">
                        <EnrolmentActions riderId={r.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Riders ({riders.length})</CardTitle>
          <CardDescription>Attendance this month + current level.</CardDescription>
        </CardHeader>
        <CardContent>
          {riders.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No riders yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">School</th>
                    <th className="pb-2">Level</th>
                    <th className="pb-2">Joined</th>
                    <th className="pb-2 text-right">Attended This Month</th>
                  </tr>
                </thead>
                <tbody>
                  {riders.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="py-2 font-medium">{r.firstName} {r.lastName}</td>
                      <td className="py-2 text-xs text-muted-foreground">{r.school ?? "—"}</td>
                      <td className="py-2">
                        {r.currentLevel ? <Badge variant="outline">{r.currentLevel}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{formatDate(r.joiningDate)}</td>
                      <td className="py-2 text-right font-mono">{attendanceByRider.get(r.id) ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Exams (Last 60 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {recentExams.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No exams in the last 60 days.</p>
          ) : (
            <ol className="space-y-1">
              {recentExams.map((e) => {
                const rider = riders.find((r) => r.id === e.riderId);
                return (
                  <li key={e.id} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
                    <div>
                      <span className="font-medium">{rider ? `${rider.firstName} ${rider.lastName}` : e.riderId}</span>
                      <span className="ml-2 text-xs text-muted-foreground">Level {e.level}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{formatDate(e.date)}</span>
                      <Badge
                        variant={
                          e.status === "completed" ? "success" :
                          e.status === "scheduled" ? "warning" :
                          "outline"
                        }
                      >
                        {formatEnum(e.status)}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skill Progress (Latest Updates)</CardTitle>
        </CardHeader>
        <CardContent>
          {recentSkills.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No skill updates yet.</p>
          ) : (
            <ol className="space-y-1">
              {recentSkills.map((s) => (
                <li key={`${s.riderId}-${s.skillId}`} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
                  <div>
                    <span className="font-medium">{s.rider.firstName} {s.rider.lastName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{s.skill.discipline} · {s.skill.name}</span>
                  </div>
                  <Badge
                    variant={
                      s.status === "mastered" ? "success" :
                      s.status === "in_progress" ? "warning" :
                      "outline"
                    }
                  >
                    {formatEnum(s.status)}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
