import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { TruncationNotice } from "@/components/ui/truncation-notice";
import { FarrierClient } from "./farrier-client";

export const dynamic = "force-dynamic";

export default async function FarrieryPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  // FarrierVisit has a centreId column but no `centre` relation, so the org
  // bound is enforced through its `horse` relation (Horse has `centre`).
  const where: any = { horse: { centre: { orgId } } };
  if (centreId) where.centreId = centreId;

  const [visits, horses, totalVisits] = await Promise.all([
    prisma.farrierVisit.findMany({
      where,
      orderBy: [{ status: "asc" }, { scheduledAt: "desc" }],
      include: { horse: { select: { id: true, name: true, stableNo: true } } },
      take: 200,
    }),
    prisma.horse.findMany({
      where: { ...tenantWhere(centreId, orgId), status: { not: "retired" } },
      select: { id: true, name: true, stableNo: true },
      orderBy: { name: "asc" },
    }),
    prisma.farrierVisit.count({ where }),
  ]);

  const now = new Date();
  const scheduled = visits.filter((v) => v.status === "scheduled");
  const completed = visits.filter((v) => v.status === "completed");
  const overdue = completed.filter((v) => v.nextDueAt && v.nextDueAt < now);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Farriery</h1>
        <p className="text-sm text-muted-foreground">
          Schedule farrier visits, close them out, and track each horse's next-due date
          (default cadence: 6 weeks after the last visit).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Scheduled" value={scheduled.length} />
        <Kpi label="Overdue" value={overdue.length} tone={overdue.length > 0 ? "amber" : undefined} />
        <Kpi label="Completed (all-time)" value={completed.length} />
        <Kpi label="Horses tracked" value={horses.length} />
      </div>

      <FarrierClient horses={horses} />

      <Card>
        <CardHeader>
          <CardTitle>Visits</CardTitle>
        </CardHeader>
        <CardContent>
          <TruncationNotice shown={visits.length} total={totalVisits} noun="farrier visits" />
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left">Horse</th>
                <th className="px-2 py-2 text-left">Scheduled</th>
                <th className="px-2 py-2 text-left">Work</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Next due</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visits.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    No visits yet — schedule one above.
                  </td>
                </tr>
              )}
              {visits.map((v) => {
                const isOverdue =
                  v.status === "completed" && v.nextDueAt && v.nextDueAt < now;
                return (
                  <tr key={v.id} className="border-t">
                    <td className="px-2 py-2">
                      <div className="font-medium">{v.horse.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {v.horse.stableNo ?? ""}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-sm">{formatDate(v.scheduledAt)}</td>
                    <td className="px-2 py-2 text-xs capitalize">{v.workType.replace("_", " ")}</td>
                    <td className="px-2 py-2">
                      <Badge variant={v.status === "completed" ? "success" : v.status === "scheduled" ? "outline" : "warning"}>
                        {v.status}
                      </Badge>
                    </td>
                    <td className={`px-2 py-2 text-sm ${isOverdue ? "font-semibold text-amber-700" : ""}`}>
                      {v.nextDueAt ? formatDate(v.nextDueAt) : "—"}
                      {isOverdue && <span className="ml-1 text-[10px] uppercase">overdue</span>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {v.status === "scheduled" && <CompleteButton id={v.id} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "amber" ? "text-amber-700 dark:text-amber-400" : ""}`}>
        {value}
      </div>
    </div>
  );
}

// Imported below — inlined as a server-side import would defeat the
// "use client" boundary. The actual implementation lives in the client file.
import { CompleteButton } from "./farrier-client";
