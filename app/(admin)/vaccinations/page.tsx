import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { TruncationNotice } from "@/components/ui/truncation-notice";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { VaccinationsClient } from "./vaccinations-client";

export const dynamic = "force-dynamic";

export default async function VaccinationsPage() {
  const session = (await getSession())!;
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const centreId = scopeCentre(session);

  // VaccinationSchedule has centreId but no `centre` relation → bind by the
  // caller's org's centre-id set (or the picked in-org centre).
  const orgCentreIds = (await prisma.centre.findMany({ where: { orgId }, select: { id: true } })).map((c) => c.id);
  const where: any = { centreId: centreId ?? { in: orgCentreIds } };

  const [rows, horses, totalSchedules] = await Promise.all([
    prisma.vaccinationSchedule.findMany({
      where,
      orderBy: { nextDueAt: "asc" },
      include: { horse: { select: { id: true, name: true, stableNo: true } } },
      take: 300,
    }),
    prisma.horse.findMany({
      where: { ...tenantWhere(centreId, orgId), status: { not: "retired" } },
      select: { id: true, name: true, stableNo: true },
      orderBy: { name: "asc" },
    }),
    prisma.vaccinationSchedule.count({ where }),
  ]);

  const now = new Date();
  const within30 = new Date(now.getTime() + 30 * 86400000);
  const overdue = rows.filter((r) => r.nextDueAt < now);
  const dueSoon = rows.filter((r) => r.nextDueAt >= now && r.nextDueAt <= within30);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Horse Health Schedules</h1>
        <p className="text-sm text-muted-foreground">Vaccinations · deworming rotations · dental checks. One nextDueAt sweep covers them all.</p>
        <p className="text-sm text-muted-foreground">
          Plan vaccination cycles per horse. Recording a dose rolls "next due" forward by the
          configured interval.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Overdue" value={overdue.length} tone={overdue.length > 0 ? "rose" : undefined} />
        <Kpi label="Due in 30 days" value={dueSoon.length} tone={dueSoon.length > 0 ? "amber" : undefined} />
        <Kpi label="All schedules" value={rows.length} />
        <Kpi label="Horses" value={horses.length} />
      </div>

      <VaccinationsClient horses={horses} />

      <Card>
        <CardHeader>
          <CardTitle>Schedules</CardTitle>
        </CardHeader>
        <CardContent>
          <TruncationNotice shown={rows.length} total={totalSchedules} noun="schedules" />
          <ResponsiveTable
            rows={rows}
            getRowKey={(r) => r.id}
            emptyMessage={`No vaccination schedules yet — add one above for any of the ${horses.length} horses.`}
            columns={[
              {
                key: "horse",
                header: "Horse",
                primary: true,
                cell: (r) => (
                  <>
                    <div className="font-medium">{r.horse.name}</div>
                    <div className="text-[11px] text-muted-foreground">{r.horse.stableNo ?? ""}</div>
                  </>
                ),
              },
              {
                key: "vaccine",
                header: "Vaccine",
                cell: (r) => (
                  <>
                    <div>{r.vaccineLabel}</div>
                    <Badge variant="outline" className="text-[10px] uppercase">{r.vaccineKey}</Badge>
                  </>
                ),
              },
              {
                key: "lastGiven",
                header: "Last given",
                cell: (r) => (r.lastGivenAt ? formatDate(r.lastGivenAt) : "—"),
              },
              {
                key: "nextDue",
                header: "Next due",
                cell: (r) => {
                  const isOverdue = r.nextDueAt < now;
                  const isSoon = !isOverdue && r.nextDueAt <= within30;
                  return (
                    <span className={isOverdue ? "font-semibold text-rose-600" : isSoon ? "font-semibold text-amber-700" : ""}>
                      {formatDate(r.nextDueAt)}
                      {isOverdue ? " · overdue" : isSoon ? " · soon" : ""}
                    </span>
                  );
                },
              },
              {
                key: "interval",
                header: "Interval",
                cell: (r) => <span className="text-xs text-muted-foreground">{r.intervalDays} days</span>,
              },
              {
                key: "action",
                header: "",
                cell: (r) => <RecordDoseButton id={r.id} />,
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "amber" | "rose" }) {
  const cls = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-700" : "";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

import { RecordDoseButton } from "./vaccinations-client";
