// School Administrator dashboard. Read-only roll-up of attendance, exam
// levels, and skill progress for one school's pupils.
//
// SCOPE. The account is pinned to a centre (User.centreId) and, optionally, to
// a School within it (User.schoolId). A school set means this administrator
// sees only that school's children; NULL means the whole centre, which is what
// every account had before schools existed and stays right while a centre
// serves one school.
//
// EVERY query on this page that touches children goes through riderScopeWhere,
// including the ones that reach riders indirectly — attendance is filtered by
// its rider, not by its batch's centre, because a batch is shared across
// schools and filtering on it would have shown one school another's register.
// A second hand-rolled `where` here is how the leak comes back.

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { EnrolmentActions } from "@/app/(admin)/enrolments/enrolment-actions";
import { formatEnum } from "@/lib/labels";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { ENROLLED_RIDER_STATUSES, RIDER_STATUS } from "@/lib/rider-status";
import { schoolScopeFor, riderScopeWhere } from "@/lib/school-scope";
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

  // The fence. NULL school = the whole centre, which is what every account had
  // before schools existed; set one and this administrator sees only their own
  // pupils. Resolved once and spread into every rider query below, so the two
  // can never disagree.
  const scope = await schoolScopeFor(session.userId);
  const riderWhere = riderScopeWhere(centreId, scope);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    centre,
    riders,
    attendanceSummary,
    recentExams,
    recentSkills,
    heldForConsent,
    pendingEnrolments,
    news,
  ] = await Promise.all([
    prisma.centre.findUnique({ where: { id: centreId }, select: { name: true } }),
    prisma.rider.findMany({
      // ENROLLED_RIDER_STATUSES rather than a hand-written list. The two
      // happened to agree, which is exactly how this kind of copy goes stale
      // unnoticed — pending_consent was added to the lifecycle without this
      // page knowing, and the next status will be too.
      where: { ...riderWhere, status: { in: [...ENROLLED_RIDER_STATUSES] } },
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
    // Attendance is a RATIO, and the two halves must be counted separately.
    //
    // This counted every attendance row for the month and printed it under
    // "Attended This Month" — so a child marked absent six times out of eight
    // showed as 8. The one number a school actually reads off this page was
    // reporting the opposite of the truth for the children it matters most for.
    prisma.attendance.groupBy({
      by: ["riderId", "status"],
      // Through the rider. Batches are shared — a school's pupils sit in the
      // same 6am batch as everyone else's — so filtering on batch.centreId
      // returned every child at the club.
      where: { date: { gte: monthStart }, rider: riderWhere },
      _count: { _all: true },
    }),
    prisma.exam.findMany({
      where: {
        rider: riderWhere,
        // Bounded at BOTH ends. With only a lower bound, an exam scheduled for
        // next week sorted to the top of a card headed "Last 60 Days".
        date: { gte: new Date(Date.now() - 60 * 86400000), lte: new Date() },
      },
      orderBy: { date: "desc" },
      take: 30,
      // Name the rider on the exam itself. This used to look the rider up in
      // the `riders` array above, which is capped at 200 and excludes anyone
      // not currently enrolled — so a withdrawn or 201st rider's exam rendered
      // as a raw cuid on a partner school's dashboard.
      include: { rider: { select: { firstName: true, lastName: true } } },
    }),
    prisma.riderSkillStatus.findMany({
      where: { rider: riderWhere },
      include: {
        rider: { select: { firstName: true, lastName: true } },
        skill: { select: { name: true, discipline: true } },
      },
      orderBy: { updatedAt: "desc" },
      // Eight, not twenty. This is the least actionable card on the page and it
      // was the longest — most of a phone screen's scrolling was this list.
      take: 8,
    }),
    // Students the club cannot put on a horse yet. A school chasing consent
    // forms is the only party who can actually move these along, so the number
    // belongs on their screen rather than only on the club's.
    prisma.rider.findMany({
      where: { ...riderWhere, status: RIDER_STATUS.PENDING_CONSENT },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true, school: true },
    }),
    prisma.rider.findMany({
      where: { ...riderWhere, status: "pending_approval", selfEnrolled: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, firstName: true, lastName: true, mobile: true, school: true, createdAt: true, verifiedAt: true },
    }),
    // Anything the club has notified this account about. Assigning a task to a
    // school administrator writes one of these, and until this card existed
    // there was nowhere in the portal to read it — the row was written and seen
    // by nobody, because /notifications belongs to the staff shell this role is
    // deliberately kept out of.
    prisma.notification.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, title: true, body: true, createdAt: true, readAt: true },
    }),
  ]);

  // Present + late is "turned up"; absent and excused are not. Excused counts
  // toward sessions offered but not toward attendance — a school asking "how
  // much riding has this child actually had" wants the honest denominator.
  const ATTENDED = new Set(["present", "late"]);
  const attendanceByRider = new Map<string, { attended: number; total: number }>();
  for (const a of attendanceSummary) {
    const row = attendanceByRider.get(a.riderId) ?? { attended: 0, total: 0 };
    row.total += a._count._all;
    if (ATTENDED.has(a.status)) row.attended += a._count._all;
    attendanceByRider.set(a.riderId, row);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {scope.schoolName ?? centre?.name ?? "Club"} — School View
        </h1>
        <p className="text-sm text-muted-foreground">
          {scope.schoolName
            ? `Your Pupils at ${centre?.name ?? "the club"}.`
            : `Every Rider at ${centre?.name ?? "the club"}.`}
        </p>
      </div>

      {pendingEnrolments.length > 0 && (
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader>
            <CardTitle>Self-Enrolments Awaiting Your Approval ({pendingEnrolments.length})</CardTitle>
            <CardDescription>
              Riders who signed up via the public link. The club checks their documents first;
              Approve becomes available once that is done.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveTable
              rows={pendingEnrolments}
              getRowKey={(r) => r.id}
              columns={[
                {
                  key: "name",
                  header: "Name",
                  primary: true,
                  cell: (r) => <span className="font-medium">{r.firstName} {r.lastName}</span>,
                },
                { key: "mobile", header: "Mobile", cell: (r) => r.mobile },
                ...(scope.schoolId
                  ? []
                  : [
                      {
                        key: "school",
                        header: "School",
                        cell: (r: (typeof pendingEnrolments)[number]) => (
                          <span className="text-xs text-muted-foreground">{r.school ?? "—"}</span>
                        ),
                      },
                    ]),
                {
                  key: "signedUp",
                  header: "Signed Up",
                  cell: (r) => (
                    <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
                  ),
                },
                {
                  key: "action",
                  header: "Action",
                  headerClassName: "text-right",
                  cell: (r) => <EnrolmentActions riderId={r.id} verified={Boolean(r.verifiedAt)} />,
                },
              ]}
            />
          </CardContent>
        </Card>
      )}

      {heldForConsent.length > 0 && (
        <Card className="border-l-4 border-l-rose-500">
          <CardHeader>
            <CardTitle>
              Cannot Ride Yet — Consent Not Signed ({heldForConsent.length})
            </CardTitle>
            <CardDescription>
              These students were added from a spreadsheet, which can&apos;t carry a signature.
              Until a parent signs the indemnity and injury NOC they can&apos;t be put on a
              register. Each one goes active automatically the moment it&apos;s signed — the club
              emails parents a signing link, and a nudge from the school usually moves it faster.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {heldForConsent.map((r) => (
                <li key={r.id} className="rounded-md border bg-muted/40 px-2 py-1 text-xs">
                  {r.firstName} {r.lastName}
                  {/* Same reason as the roll's School column: when this account
                      is fenced to one school, naming it on every chip is noise. */}
                  {!scope.schoolId && r.school ? (
                    <span className="ml-1 text-muted-foreground">· {r.school}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {news.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What&apos;s New</CardTitle>
            <CardDescription>
              Messages from the club. Anything needing a reply from you is on the Tasks tab.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {news.map((n) => (
                <li
                  key={n.id}
                  className="flex items-start justify-between gap-3 border-b py-2 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <div className={n.readAt ? "font-medium" : "font-semibold"}>{n.title}</div>
                    {n.body && (
                      <div className="text-xs text-muted-foreground">{n.body}</div>
                    )}
                  </div>
                  {/* No link, deliberately: a notification's `link` points into
                      the staff workspace (/tasks and friends), which this role
                      is redirected out of — so following one would bounce them
                      back here looking broken. */}
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                    {formatDate(n.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            {/* Named for what it counts. "Riders (6)" here against "7 students"
                on the Riders tab looked like one of them was wrong; they count
                different things, so they now say so. */}
            <CardTitle>Riders Cleared to Ride ({riders.length})</CardTitle>
            <Link href="/school/riders" className="text-xs text-primary underline">
              Full roll with class, measurements and attendance →
            </Link>
          </div>
          <CardDescription>
            Attendance this month, counted as turned-up / sessions offered. Students held for
            consent are listed separately above and are not counted here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={riders}
            getRowKey={(r) => r.id}
            emptyMessage="No riders yet."
            columns={[
              {
                key: "name",
                header: "Name",
                primary: true,
                cell: (r) => (
                  <Link href={`/school/riders/${r.id}`} className="font-medium hover:underline">
                    {r.firstName} {r.lastName}
                  </Link>
                ),
              },
              // Only worth a column when this account can see more than one
              // school. Fenced to one, it repeated the same name down every row
              // — and wrapped to three lines on every card on a phone.
              ...(scope.schoolId
                ? []
                : [
                    {
                      key: "school",
                      header: "School",
                      cell: (r: (typeof riders)[number]) => (
                        <span className="text-xs text-muted-foreground">{r.school ?? "—"}</span>
                      ),
                    },
                  ]),
              {
                key: "level",
                header: "Level",
                cell: (r) =>
                  r.currentLevel ? (
                    <Badge variant="outline">{r.currentLevel}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                key: "joined",
                header: "Joined",
                cell: (r) => (
                  <span className="text-xs text-muted-foreground">{formatDate(r.joiningDate)}</span>
                ),
              },
              {
                key: "attendance",
                header: "Attended / Sessions (This Month)",
                numeric: true,
                cell: (r) => {
                  const a = attendanceByRider.get(r.id);
                  if (!a || a.total === 0) return <span className="text-muted-foreground">—</span>;
                  return (
                    <>
                      {a.attended}
                      <span className="text-muted-foreground">/{a.total}</span>
                    </>
                  );
                },
              },
            ]}
          />
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
                return (
                  <li key={e.id} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
                    <div>
                      <span className="font-medium">{`${e.rider.firstName} ${e.rider.lastName}`}</span>
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
                <li key={`${s.riderId}-${s.skillId}`} className="flex items-center justify-between gap-3 border-b py-1.5 text-sm last:border-0">
                  <div className="min-w-0">
                    <span className="font-medium">{s.rider.firstName} {s.rider.lastName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{s.skill.discipline} · {s.skill.name}</span>
                  </div>
                  {/* The date is what makes "Latest Updates" checkable — without
                      it the card asserted recency and showed no evidence. */}
                  <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                    {formatDate(s.updatedAt)}
                  </span>
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
