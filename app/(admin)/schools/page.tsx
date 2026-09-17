import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SchoolsClient } from "./schools-client";

export const dynamic = "force-dynamic";

// Partner schools, and which administrator can see which children.
//
// This page exists because the fence it edits is invisible everywhere else: a
// school administrator's reach used to be decided entirely by their centre, so
// there was nothing to look at and nothing to get wrong. Now that one centre
// can host several schools, "who can see whose children" is a real setting, and
// a real setting with no screen is a setting nobody checks.

export default async function SchoolsPage() {
  const session = await requireSession();
  if (!can(session.role, "staff.manage")) redirect("/dashboard");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const centreId = scopeCentre(session);

  const centre = centreId
    ? await prisma.centre.findFirst({ where: { id: centreId, orgId }, select: { name: true } })
    : null;

  if (!centre || !centreId) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Schools</CardTitle>
            <CardDescription>
              Pick a centre from the selector in the top bar. Schools belong to one centre, and
              so does the administrator attached to them.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const [schools, admins] = await Promise.all([
    prisma.school.findMany({
      where: { centreId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { riders: true } } },
    }),
    prisma.user.findMany({
      where: { centreId, role: "SCHOOL_ADMINISTRATOR" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, schoolId: true },
    }),
  ]);

  // Riders whose school name never resolved to a row — blank, or a non-answer
  // like "Nil". Worth showing, because a fenced administrator will not see them
  // and the club would otherwise have no hint as to why.
  const unassigned = await prisma.rider.count({
    where: { centreId, schoolId: null, status: { notIn: ["withdrawn", "rejected", "cancelled"] } },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Schools</h1>
        <p className="text-sm text-muted-foreground">{centre.name}</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <SchoolsClient
            schools={schools.map((s) => ({
              id: s.id,
              name: s.name,
              riderCount: s._count.riders,
            }))}
            admins={admins}
          />
        </CardContent>
      </Card>

      {unassigned > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {unassigned} Rider{unassigned === 1 ? "" : "s"} With No School
            </CardTitle>
            <CardDescription>
              Their school field is blank or was a non-answer, so they belong to no school row.
              An administrator fenced to one school will <strong>not</strong> see them — only an
              unfenced one will. Set a school on each rider&apos;s profile, or include the
              <code className="mx-1">school</code> column next time you bulk upload.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
