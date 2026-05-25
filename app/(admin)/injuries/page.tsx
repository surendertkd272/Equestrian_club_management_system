import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { InjuriesClient } from "./injuries-client";

export const dynamic = "force-dynamic";

export default async function InjuriesPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const where: any = {};
  if (centreId) where.centreId = centreId;

  const [rows, horses, riders] = await Promise.all([
    prisma.injuryLog.findMany({
      where,
      orderBy: [{ status: "asc" }, { occurredAt: "desc" }],
      take: 200,
    }),
    prisma.horse.findMany({
      where: centreId ? { centreId } : {},
      select: { id: true, name: true, stableNo: true },
      orderBy: { name: "asc" },
    }),
    prisma.rider.findMany({
      where: centreId ? { centreId, status: "active" } : { status: "active" },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
  ]);

  // Name resolution per row — single batched lookup against the loaded lists
  // to avoid N+1.
  const horseById = new Map(horses.map((h) => [h.id, h]));
  const riderById = new Map(riders.map((r) => [r.id, r]));

  const active = rows.filter((r) => r.status === "active" || r.status === "recovering");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Injury Treatment Log</h1>
        <p className="text-sm text-muted-foreground">
          Track injuries for horses and riders. Append treatment entries as care happens,
          and mark recovered when the rider/horse is back to normal duty.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Active / recovering" value={active.length} tone={active.length > 0 ? "amber" : undefined} />
        <Kpi label="Severe" value={rows.filter((r) => r.severity === "severe").length} />
        <Kpi label="Total tracked" value={rows.length} />
        <Kpi label="Recovered" value={rows.filter((r) => r.status === "recovered").length} />
      </div>

      <InjuriesClient horses={horses} riders={riders} />

      <Card>
        <CardHeader>
          <CardTitle>Records</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No injuries logged. Hopefully it stays that way.
            </p>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Subject</th>
                  <th className="px-2 py-2">Occurred</th>
                  <th className="px-2 py-2">Location</th>
                  <th className="px-2 py-2">Severity</th>
                  <th className="px-2 py-2">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const subjectName =
                    r.subjectType === "horse"
                      ? horseById.get(r.subjectId)?.name ?? "Unknown horse"
                      : riderById.get(r.subjectId)
                        ? `${riderById.get(r.subjectId)!.firstName} ${riderById.get(r.subjectId)!.lastName}`
                        : "Unknown rider";
                  const treatments = r.treatmentJson ? safeArrLen(r.treatmentJson) : 0;
                  return (
                    <tr key={r.id} className="border-t align-top">
                      <td className="px-2 py-2">
                        <div className="font-medium">{subjectName}</div>
                        <div className="text-[10px] uppercase text-muted-foreground">{r.subjectType}</div>
                      </td>
                      <td className="px-2 py-2">{formatDate(r.occurredAt)}</td>
                      <td className="px-2 py-2">{r.location ?? "—"}</td>
                      <td className="px-2 py-2">
                        <Badge variant={r.severity === "severe" ? "destructive" : r.severity === "moderate" ? "warning" : "outline"}>
                          {r.severity}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={r.status === "recovered" ? "success" : r.status === "chronic" ? "warning" : "outline"}>
                          {r.status}
                        </Badge>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {treatments} treatment{treatments === 1 ? "" : "s"}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <InjuryRowActions id={r.id} status={r.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function safeArrLen(json: string): number {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
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

import { InjuryRowActions } from "./injuries-client";
