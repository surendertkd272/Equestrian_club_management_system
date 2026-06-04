import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { VaccinationsClient } from "./vaccinations-client";

export const dynamic = "force-dynamic";

export default async function VaccinationsPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const where: any = {};
  if (centreId) where.centreId = centreId;

  const [rows, horses] = await Promise.all([
    prisma.vaccinationSchedule.findMany({
      where,
      orderBy: { nextDueAt: "asc" },
      include: { horse: { select: { id: true, name: true, stableNo: true } } },
      take: 300,
    }),
    prisma.horse.findMany({
      where: centreId ? { centreId, status: { not: "retired" } } : { status: { not: "retired" } },
      select: { id: true, name: true, stableNo: true },
      orderBy: { name: "asc" },
    }),
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
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No vaccination schedules yet — add one above for any of the {horses.length} horses.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Horse</th>
                  <th className="px-2 py-2">Vaccine</th>
                  <th className="px-2 py-2">Last given</th>
                  <th className="px-2 py-2">Next due</th>
                  <th className="px-2 py-2">Interval</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOverdue = r.nextDueAt < now;
                  const isSoon = !isOverdue && r.nextDueAt <= within30;
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-2 py-2">
                        <div className="font-medium">{r.horse.name}</div>
                        <div className="text-[11px] text-muted-foreground">{r.horse.stableNo ?? ""}</div>
                      </td>
                      <td className="px-2 py-2">
                        <div>{r.vaccineLabel}</div>
                        <Badge variant="outline" className="text-[10px] uppercase">{r.vaccineKey}</Badge>
                      </td>
                      <td className="px-2 py-2">{r.lastGivenAt ? formatDate(r.lastGivenAt) : "—"}</td>
                      <td className={`px-2 py-2 ${isOverdue ? "font-semibold text-rose-600" : isSoon ? "font-semibold text-amber-700" : ""}`}>
                        {formatDate(r.nextDueAt)}
                        {isOverdue ? " · overdue" : isSoon ? " · soon" : ""}
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">{r.intervalDays} days</td>
                      <td className="px-2 py-2 text-right">
                        <RecordDoseButton id={r.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
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
