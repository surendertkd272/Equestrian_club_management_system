import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
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
  const session = (await getSession())!;
  if (!can(session.role, "progress.write")) redirect("/dashboard");

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

  const yearMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month ?? "")
    ? searchParams.month!
    : currentYearMonth();

  const [skills, riders, marks] = await Promise.all([
    prisma.monthlySkillCatalog.findMany({
      where: { centreId, yearMonth },
      orderBy: { orderIndex: "asc" },
    }),
    prisma.rider.findMany({
      where: { centreId, status: "active" },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.monthlySkillMark.findMany({
      where: { catalog: { centreId, yearMonth } },
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
        <p className="text-sm text-muted-foreground">
          Curate the skills coaches will rate this month, then mark each rider's progress.
          The rating scale (0 – 3) is shared across the squad — see the legend below the table.
        </p>
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
