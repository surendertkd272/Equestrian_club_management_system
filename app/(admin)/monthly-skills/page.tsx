import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isReadOnly } from "@/lib/roles";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthlySkillsClient } from "./monthly-skills-client";

export const dynamic = "force-dynamic";

// Current month in IST. yearMonth is the canonical key for catalog rows;
// admin can switch to any prior month with the picker on the client.
function currentYearMonth(): string {
  const now = new Date();
  // Use UTC + IST offset (5h30m) for stability across server timezones.
  const ist = new Date(now.getTime() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function MonthlySkillsPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const session = await requireSession();
  // Read-only roles (SCHOOL_ADMINISTRATOR) see the page; everyone else
  // needs progress.write to land here. The client is told whether to
  // render edit UI via canEdit below.
  const canEdit = can(session.role, "progress.write");
  if (!canEdit && !isReadOnly(session.role)) redirect("/dashboard");

  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Monthly Skills</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Pick a centre from the top-bar filter to track monthly skills.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Org-bound the centre so an HQ user can't open another org's centre via
  // ?centre= / the ew_hq_centre cookie — a foreign centreId then matches 0 rows.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const yearMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month ?? "")
    ? searchParams.month!
    : currentYearMonth();

  const [skills, riders, marks] = await Promise.all([
    prisma.monthlySkillCatalog.findMany({
      where: { ...tenantWhere(centreId, orgId), yearMonth },
      orderBy: { orderIndex: "asc" },
    }),
    prisma.rider.findMany({
      where: { ...tenantWhere(centreId, orgId), status: "active" },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.monthlySkillMark.findMany({
      where: { catalog: { ...tenantWhere(centreId, orgId), yearMonth } },
      select: { catalogId: true, riderId: true, rating: true, coachNotes: true },
    }),
  ]);

  const marksByKey = new Map(
    marks.map((m) => [`${m.catalogId}:${m.riderId}`, { rating: m.rating, coachNotes: m.coachNotes }]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Monthly Skills</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tracking for {yearMonth}</CardTitle>
          <CardDescription>
            Catalog is per-month, per-centre. Past months stay visible via the picker.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlySkillsClient
            yearMonth={yearMonth}
            canEdit={canEdit}
            skills={skills.map((s) => ({
              id: s.id,
              skillLabel: s.skillLabel,
              orderIndex: s.orderIndex,
              active: s.active,
            }))}
            riders={riders.map((r) => ({
              id: r.id,
              name: `${r.firstName} ${r.lastName ?? ""}`.trim(),
            }))}
            initialMarks={Object.fromEntries(marksByKey)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
