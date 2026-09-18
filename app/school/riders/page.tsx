import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ENROLLED_RIDER_STATUSES, RIDER_STATUS } from "@/lib/rider-status";
import { schoolContext } from "@/lib/school-portal";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { NoCentreCard } from "../no-centre";

export const dynamic = "force-dynamic";

// The school's own roll.
//
// WHAT IS DELIBERATELY NOT HERE: Aadhaar, fees and invoices, medical notes.
// A partner school is not the child's guardian and has no role in the club's
// billing, so the portal shows what the school itself supplied (class, section,
// the measurements their data sheet collected) and what the club produced from
// it (level, batch, attendance, consent state). Allergies are the one medical
// field included, because a school taking children to a stable needs it and
// asked for it on the collection sheet.

function ageOn(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export default async function SchoolRidersPage() {
  const ctx = await schoolContext();
  if (!ctx) return <NoCentreCard />;

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [riders, attendance] = await Promise.all([
    prisma.rider.findMany({
      where: {
        ...ctx.riderWhere,
        status: { in: [...ENROLLED_RIDER_STATUSES, RIDER_STATUS.PENDING_CONSENT] },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dob: true,
        gender: true,
        schoolClass: true,
        schoolSection: true,
        currentLevel: true,
        joiningDate: true,
        status: true,
        heightCm: true,
        weightKg: true,
        bmi: true,
        allergies: true,
        // Batch carries coachId but has no coach relation, so the names are
        // resolved in one lookup below rather than per row.
        batch: { select: { name: true, coachId: true } },
      },
    }),
    prisma.attendance.groupBy({
      by: ["riderId", "status"],
      where: { date: { gte: monthStart }, rider: ctx.riderWhere },
      _count: { _all: true },
    }),
  ]);

  // One query for every coach named on these batches.
  const coachIds = [...new Set(riders.map((r) => r.batch?.coachId).filter(Boolean) as string[])];
  const coaches = coachIds.length
    ? await prisma.user.findMany({
        where: { id: { in: coachIds } },
        select: { id: true, name: true },
      })
    : [];
  const coachName = new Map(coaches.map((c) => [c.id, c.name]));

  const ATTENDED = new Set(["present", "late"]);
  const att = new Map<string, { attended: number; total: number }>();
  for (const a of attendance) {
    const row = att.get(a.riderId) ?? { attended: 0, total: 0 };
    row.total += a._count._all;
    if (ATTENDED.has(a.status)) row.attended += a._count._all;
    att.set(a.riderId, row);
  }

  const held = riders.filter((r) => r.status === RIDER_STATUS.PENDING_CONSENT).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Riders</h1>
        <p className="text-sm text-muted-foreground">
          {riders.length} student{riders.length === 1 ? "" : "s"} · {ctx.title}
          {held > 0 && ` · ${held} waiting on consent`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Student Roll</CardTitle>
          <CardDescription>
            Class and measurements are what your school supplied; level, batch and attendance
            come from the club. Attendance is this month, counted as turned-up / sessions
            offered.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={riders}
            getRowKey={(r) => r.id}
            emptyMessage="No students yet."
            columns={[
              {
                key: "name",
                header: "Name",
                primary: true,
                cell: (r) => (
                  <span className="font-medium">
                    {r.firstName} {r.lastName}
                  </span>
                ),
              },
              {
                key: "class",
                header: "Class",
                cell: (r) => [r.schoolClass, r.schoolSection].filter(Boolean).join("-") || <Dash />,
              },
              { key: "age", header: "Age", cell: (r) => ageOn(r.dob) },
              {
                key: "level",
                header: "Level",
                cell: (r) =>
                  r.currentLevel ? <Badge variant="outline">{r.currentLevel}</Badge> : <Dash />,
              },
              { key: "batch", header: "Batch", cell: (r) => r.batch?.name ?? <Dash /> },
              {
                key: "coach",
                header: "Coach",
                cell: (r) => (
                  <span className="text-xs">
                    {(r.batch?.coachId && coachName.get(r.batch.coachId)) || <Dash />}
                  </span>
                ),
              },
              {
                key: "measurements",
                header: "Ht / Wt / BMI",
                // Low priority on a phone: useful in a review, not what a
                // school opens the roll to check.
                hideOnMobile: true,
                cell: (r) =>
                  r.heightCm || r.weightKg ? (
                    <span className="font-mono text-xs">
                      {r.heightCm ?? "–"}cm / {r.weightKg ?? "–"}kg
                      {r.bmi ? ` / ${r.bmi.toFixed(1)}` : ""}
                    </span>
                  ) : (
                    <Dash />
                  ),
              },
              {
                key: "allergies",
                header: "Allergies",
                cell: (r) =>
                  r.allergies ? (
                    <span className="text-xs text-amber-700 dark:text-amber-400">{r.allergies}</span>
                  ) : (
                    <Dash />
                  ),
              },
              {
                key: "joined",
                header: "Joined",
                hideOnMobile: true,
                cell: (r) => (
                  <span className="text-xs text-muted-foreground">{formatDate(r.joiningDate)}</span>
                ),
              },
              {
                key: "attendance",
                header: "Attendance",
                numeric: true,
                cell: (r) => {
                  const a = att.get(r.id);
                  return a && a.total > 0 ? (
                    <>
                      {a.attended}
                      <span className="text-muted-foreground">/{a.total}</span>
                    </>
                  ) : (
                    <Dash />
                  );
                },
              },
              {
                key: "status",
                header: "Status",
                headerClassName: "text-right",
                cell: (r) =>
                  r.status === RIDER_STATUS.PENDING_CONSENT ? (
                    <Badge variant="destructive">Consent</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}
