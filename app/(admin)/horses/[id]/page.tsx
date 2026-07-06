import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { startOfDayInTz } from "@/lib/tz";
import { DEFAULT_WORKLOAD_CAP_MIN } from "@/lib/schemas/horse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { formatDate, displayAgeYears } from "@/lib/utils";
import { NewAllocationForm } from "./new-allocation";
import { DeleteAllocation } from "./delete-allocation";
import { StatusSelect } from "./status-select";
import { HealthLogPanel } from "./health-log-panel";
import { FeedPlanPanel } from "./feed-plan-panel";
import { VetVisitsPanel } from "./vet-visits-panel";
import { HorseTestsPanel } from "./tests-panel";
import { ActivityFeed } from "@/components/shell/activity-feed";
import { horseActivity } from "@/lib/activity";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline"> = {
  active: "success",
  rest: "warning",
  retired: "outline",
};

export default async function HorseProfile({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) notFound();

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    include: {
      centre: { select: { name: true, timezone: true } },
    },
  });
  if (!horse) notFound();
  if (centreId && horse.centreId !== centreId) notFound();
  // Org-ownership guard: HQ users (centreId=null) bypass the centre check
  // above, so bound them by org — an HQ user can't open another org's horse.
  if ((await getOrgIdForCentre(horse.centreId)) !== orgId) notFound();

  const canManage = can(session.role, "horse.manage");
  // Centre-local "today" for due-date coloring (matches /vaccinations).
  const todayStart = startOfDayInTz(new Date(), horse.centre.timezone);

  // Today's allocations + a window of upcoming.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const [todaysAllocs, upcoming, riders, healthLogs, vaccinationSchedules, feedPlan, vetVisits, medicines] = await Promise.all([
    prisma.horseAllocation.findMany({
      where: { horseId: horse.id, startAt: { gte: dayStart, lte: dayEnd } },
      include: { rider: { select: { firstName: true, lastName: true, id: true } } },
      orderBy: { startAt: "asc" },
    }),
    prisma.horseAllocation.findMany({
      where: { horseId: horse.id, startAt: { gt: dayEnd } },
      include: { rider: { select: { firstName: true, lastName: true, id: true } } },
      orderBy: { startAt: "asc" },
      take: 20,
    }),
    canManage
      ? prisma.rider.findMany({
          where: { centreId: horse.centreId, status: "active" },
          select: { id: true, firstName: true, lastName: true },
          orderBy: { firstName: "asc" },
        })
      : Promise.resolve([]),
    prisma.horseHealthLog.findMany({
      where: { horseId: horse.id },
      orderBy: { recordedAt: "desc" },
      take: 60,
    }),
    prisma.vaccinationSchedule.findMany({
      where: { horseId: horse.id },
      orderBy: { nextDueAt: "asc" },
    }),
    prisma.feedPlan.findUnique({ where: { horseId: horse.id } }),
    prisma.vetVisit.findMany({
      where: { horseId: horse.id },
      orderBy: { visitDate: "desc" },
      include: {
        vet: { select: { id: true, name: true } },
        prescriptions: true,
      },
      take: 50,
    }),
    // Medicine options for the prescription picker — centre-scoped, only
    // unexpired stock. Vet may still type a free-text drug if it's not in
    // the dropdown (will be flagged "not in stock" in the visit timeline).
    prisma.medicine.findMany({
      where: { centreId: horse.centreId, expDate: { gte: new Date() } },
      select: { id: true, name: true, qty: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const horseTests = await prisma.horseTest.findMany({
    where: { horseId: horse.id },
    orderBy: { testedAt: "desc" },
    take: 50,
  });

  const usedMin = todaysAllocs.reduce((s, a) => s + (a.endAt.getTime() - a.startAt.getTime()) / 60000, 0);
  const pct = Math.min(100, Math.round((usedMin / DEFAULT_WORKLOAD_CAP_MIN) * 100));
  const remaining = Math.max(0, DEFAULT_WORKLOAD_CAP_MIN - usedMin);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/horses">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/horses/${horse.id}/edit`}>Edit</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/horses/${horse.id}/medical`}>Medical records →</Link>
          </Button>
          <Badge variant={STATUS_VARIANT[horse.status] ?? "outline"}>{formatEnum(horse.status)}</Badge>
          {canManage && <StatusSelect horseId={horse.id} currentStatus={horse.status} />}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{horse.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Breed</dt>
              <dd className="col-span-2">{horse.breed ?? "—"}</dd>
              <dt className="text-muted-foreground">Sex / Age</dt>
              <dd className="col-span-2">
                {horse.sex ?? "—"}
                {(() => {
                  const age = displayAgeYears(horse.dob, horse.ageYears);
                  return age !== null ? ` · ${age}y${horse.dob ? ` (b. ${formatDate(horse.dob)})` : ""}` : "";
                })()}
              </dd>
              <dt className="text-muted-foreground">Height</dt>
              <dd className="col-span-2">{horse.heightIn ? `${horse.heightIn} in` : "—"}</dd>
              <dt className="text-muted-foreground">Ownership</dt>
              <dd className="col-span-2">{horse.ownership ?? "—"}</dd>
              <dt className="text-muted-foreground">Stable</dt>
              <dd className="col-span-2">{horse.stableNo ?? "—"}</dd>
              <dt className="text-muted-foreground">Microchip</dt>
              <dd className="col-span-2 font-mono text-xs">{horse.microchip ?? "—"}</dd>
              <dt className="text-muted-foreground">EFI ID</dt>
              <dd className="col-span-2 font-mono text-xs">{horse.efiHorseId ?? "—"}</dd>
              <dt className="text-muted-foreground">Home Club</dt>
              <dd className="col-span-2">{horse.homeClub ?? "—"}</dd>
              <dt className="text-muted-foreground">Diet</dt>
              <dd className="col-span-2">{horse.diet ?? "—"}</dd>
              <dt className="text-muted-foreground">Added</dt>
              <dd className="col-span-2">{formatDate(horse.createdAt)}</dd>
            </dl>

            {(horse.insurerName || horse.insurancePolicyNo || horse.insuranceValidTo) && (
              <div className="mt-4 rounded-md border bg-muted/30 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Insurance
                </div>
                <dl className="grid grid-cols-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Insurer</dt>
                  <dd className="col-span-2">{horse.insurerName ?? "—"}</dd>
                  <dt className="text-muted-foreground">Policy #</dt>
                  <dd className="col-span-2 font-mono text-xs">{horse.insurancePolicyNo ?? "—"}</dd>
                  <dt className="text-muted-foreground">Premium</dt>
                  <dd className="col-span-2">
                    {horse.insurancePremium !== null ? `₹${horse.insurancePremium.toLocaleString("en-IN")}` : "—"}
                  </dd>
                  <dt className="text-muted-foreground">Valid</dt>
                  <dd className="col-span-2">
                    {horse.insuranceValidFrom ? formatDate(horse.insuranceValidFrom) : "?"}
                    {" → "}
                    {horse.insuranceValidTo ? (
                      <span
                        className={
                          horse.insuranceValidTo < todayStart
                            ? "font-semibold text-destructive"
                            : horse.insuranceValidTo.getTime() - Date.now() < 30 * 86400000
                              ? "font-semibold text-amber-700"
                              : ""
                        }
                      >
                        {formatDate(horse.insuranceValidTo)}
                        {horse.insuranceValidTo < todayStart ? " · EXPIRED" : ""}
                        {horse.insuranceValidTo >= todayStart &&
                          horse.insuranceValidTo.getTime() - Date.now() < 30 * 86400000
                          ? " · expiring"
                          : ""}
                      </span>
                    ) : (
                      "?"
                    )}
                  </dd>
                </dl>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today's Workload</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-3xl font-bold">
                {Math.round(usedMin)}
                <span className="text-base font-normal text-muted-foreground"> / {DEFAULT_WORKLOAD_CAP_MIN} min</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {remaining} min remaining today · cap {DEFAULT_WORKLOAD_CAP_MIN / 60} h
            </div>
            <div className="border-t pt-2 text-xs text-muted-foreground">
              {todaysAllocs.length} allocation{todaysAllocs.length === 1 ? "" : "s"} scheduled.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vet Visits</CardTitle>
        </CardHeader>
        <CardContent>
          <VetVisitsPanel
            horseId={horse.id}
            canWrite={session.role === "VET" || session.role === "SUPER_ADMIN" || session.role === "CENTRE_MANAGER"}
            medicines={medicines}
            initial={vetVisits.map((v) => ({
              id: v.id,
              visitDate: v.visitDate.toISOString(),
              reason: v.reason,
              notes: v.notes,
              followUpAt: v.followUpAt?.toISOString() ?? null,
              vet: v.vet,
              prescriptions: v.prescriptions.map((p) => ({
                id: p.id,
                medicineId: p.medicineId,
                medicineName: p.medicineName,
                dose: p.dose,
                route: p.route,
                durationDays: p.durationDays,
                frequency: p.frequency,
                notes: p.notes,
              })),
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lab Tests</CardTitle>
        </CardHeader>
        <CardContent>
          <HorseTestsPanel
            horseId={horse.id}
            canWrite={session.role === "VET" || session.role === "SUPER_ADMIN" || session.role === "CENTRE_MANAGER"}
            initial={horseTests.map((t) => ({
              id: t.id,
              testType: t.testType as "coggins" | "glanders" | "urination",
              result: t.result as "negative" | "positive" | "pending" | "inconclusive",
              testedAt: t.testedAt.toISOString(),
              nextDueAt: t.nextDueAt?.toISOString() ?? null,
              labName: t.labName,
              reportUrl: t.reportUrl,
              notes: t.notes,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Health Log</CardTitle>
        </CardHeader>
        <CardContent>
          <HealthLogPanel
            horseId={horse.id}
            initial={healthLogs.map((l) => ({
              id: l.id,
              recordedAt: l.recordedAt.toISOString(),
              tempC: l.tempC,
              heartRateBpm: l.heartRateBpm,
              respirationRpm: l.respirationRpm,
              weightKg: l.weightKg,
              appetite: l.appetite,
              manure: l.manure,
              notes: l.notes,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feed Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <FeedPlanPanel
            horseId={horse.id}
            canManage={canManage}
            initial={feedPlan ? { rations: feedPlan.rationsJson, notes: feedPlan.notes ?? "" } : null}
          />
        </CardContent>
      </Card>

      {vaccinationSchedules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Vaccinations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">Vaccine</th>
                  <th className="px-2 py-1">Last Given</th>
                  <th className="px-2 py-1">Next Due</th>
                  <th className="px-2 py-1">Interval</th>
                </tr>
              </thead>
              <tbody>
                {vaccinationSchedules.map((v) => {
                  const overdue = v.nextDueAt < todayStart;
                  return (
                    <tr key={v.id} className="border-t">
                      <td className="px-2 py-1">{v.vaccineLabel}</td>
                      <td className="px-2 py-1">{v.lastGivenAt ? formatDate(v.lastGivenAt) : "—"}</td>
                      <td className={`px-2 py-1 ${overdue ? "font-semibold text-amber-700" : ""}`}>
                        {formatDate(v.nextDueAt)}{overdue ? " · overdue" : ""}
                      </td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">{v.intervalDays} days</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            <div className="mt-2 text-xs text-muted-foreground">
              Edit schedules + record doses from{" "}
              <Link href="/vaccinations" className="underline">/vaccinations</Link>.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Today's Allocations</CardTitle>
        </CardHeader>
        <CardContent>
          {todaysAllocs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nothing scheduled today.</p>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Purpose</th>
                  <th className="pb-2">Rider</th>
                  <th className="pb-2">Duration</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {todaysAllocs.map((a) => {
                  const dur = Math.round((a.endAt.getTime() - a.startAt.getTime()) / 60000);
                  return (
                    <tr key={a.id} className="border-t">
                      <td className="py-2 font-mono text-xs">
                        {a.startAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} –{" "}
                        {a.endAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-2 capitalize">{formatEnum(a.purpose)}</td>
                      <td className="py-2">
                        {a.rider ? (
                          <Link href={`/riders/${a.rider.id}`} className="text-primary underline">
                            {a.rider.firstName} {a.rider.lastName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2">{dur} min</td>
                      <td className="py-2 text-right">
                        {canManage && <DeleteAllocation horseId={horse.id} allocId={a.id} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </CardContent>
      </Card>

      {canManage && horse.status === "active" && (
        <Card>
          <CardHeader>
            <CardTitle>New Allocation</CardTitle>
          </CardHeader>
          <CardContent>
            <NewAllocationForm horseId={horse.id} riders={riders} />
          </CardContent>
        </Card>
      )}

      {upcoming.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <span>
                    {a.startAt.toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    <span className="capitalize">{formatEnum(a.purpose)}</span>
                    {a.rider && ` · ${a.rider.firstName} ${a.rider.lastName}`}
                  </span>
                  {canManage && <DeleteAllocation horseId={horse.id} allocId={a.id} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ActivityFeed items={await horseActivity(horse.id)} title="Activity timeline" />
    </div>
  );
}
