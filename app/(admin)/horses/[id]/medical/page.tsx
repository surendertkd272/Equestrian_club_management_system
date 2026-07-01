import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { startOfDayInTz } from "@/lib/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { MedicalTabs } from "./medical-tabs";
import { DewormingPanel } from "./deworming-panel";
import { TemperatureChart } from "./temperature-chart";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

// Unified medical-record view for one horse. Replaces the scrolling page
// of mixed sections on the main horse profile — admins, vets, and stable
// staff click one tab to focus on a single record stream.
export default async function HorseMedicalPage({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    include: { centre: { select: { name: true, timezone: true } } },
  });
  if (!horse) notFound();
  if (centreId && horse.centreId !== centreId) notFound();
  // Org ownership guard: HQ users (centreId=null) bypass the centre check above,
  // so bound them to their own org — otherwise an HQ user could open another
  // org's horse by id.
  const orgId = await getOrgIdForSession(session);
  if (!orgId || (await getOrgIdForCentre(horse.centreId)) !== orgId) notFound();

  const canWriteMedical =
    can(session.role, "medicine.manage") || can(session.role, "horse.manage");

  const [vaccinations, deworming, healthLogs, injuries, farrierVisits] = await Promise.all([
    prisma.vaccinationSchedule.findMany({
      where: { horseId: horse.id },
      orderBy: { nextDueAt: "asc" },
    }),
    prisma.dewormingSchedule.findMany({
      where: { horseId: horse.id },
      orderBy: [{ givenAt: "desc" }, { scheduledAt: "desc" }],
    }),
    prisma.horseHealthLog.findMany({
      where: { horseId: horse.id, tempC: { not: null } },
      orderBy: { recordedAt: "asc" },
      take: 60,
    }),
    prisma.injuryLog.findMany({
      where: { subjectType: "horse", subjectId: horse.id },
      orderBy: { occurredAt: "desc" },
      take: 40,
    }),
    prisma.farrierVisit.findMany({
      where: { horseId: horse.id },
      orderBy: { scheduledAt: "desc" },
      take: 40,
    }),
  ]);

  const now = new Date();
  // Centre-local "today" for due-date coloring (matches /vaccinations + /farriery).
  const todayStart = startOfDayInTz(now, horse.centre.timezone);
  const insuranceExpired = horse.insuranceValidTo && horse.insuranceValidTo < todayStart;
  const insuranceExpiring =
    horse.insuranceValidTo &&
    !insuranceExpired &&
    horse.insuranceValidTo.getTime() - now.getTime() < 30 * 86400000;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/horses/${horse.id}`}>
            <ChevronLeft className="h-4 w-4" /> Back to profile
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">
          {horse.name} <span className="text-sm font-normal text-muted-foreground">· medical records</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          {horse.centre.name}
          {horse.stableNo ? ` · stable ${horse.stableNo}` : ""}
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <MedicalTabs
            initial="vaccination"
            tabs={{
              vaccination: (
                <VaccinationsPanel
                  todayStart={todayStart}
                  rows={vaccinations.map((v) => ({
                    id: v.id,
                    label: v.vaccineLabel,
                    key: v.vaccineKey,
                    lastGivenAt: v.lastGivenAt,
                    nextDueAt: v.nextDueAt,
                    intervalDays: v.intervalDays,
                  }))}
                />
              ),
              deworming: (
                <DewormingPanel
                  horseId={horse.id}
                  canWrite={canWriteMedical}
                  todayStartMs={todayStart.getTime()}
                  entries={deworming.map((d) => ({
                    id: d.id,
                    product: d.product,
                    scheduledAt: d.scheduledAt.toISOString(),
                    givenAt: d.givenAt?.toISOString() ?? null,
                    nextDueAt: d.nextDueAt?.toISOString() ?? null,
                    notes: d.notes,
                  }))}
                />
              ),
              temperature: (
                <TemperatureChart
                  points={healthLogs
                    .filter((l) => l.tempC !== null)
                    .map((l) => ({ recordedAt: l.recordedAt.toISOString(), tempC: l.tempC! }))}
                />
              ),
              injury: (
                <InjuriesPanel
                  rows={injuries.map((i) => ({
                    id: i.id,
                    occurredAt: i.occurredAt,
                    location: i.location,
                    severity: i.severity,
                    initialNotes: i.initialNotes,
                    status: i.status,
                  }))}
                />
              ),
              farrier: (
                <FarrierPanel
                  todayStart={todayStart}
                  rows={farrierVisits.map((f) => ({
                    id: f.id,
                    scheduledAt: f.scheduledAt,
                    completedAt: f.completedAt,
                    workType: f.workType,
                    status: f.status,
                    nextDueAt: f.nextDueAt,
                    farrierName: f.farrierName,
                  }))}
                />
              ),
              insurance: (
                <InsurancePanel
                  insurer={horse.insurerName}
                  policyNo={horse.insurancePolicyNo}
                  premium={horse.insurancePremium}
                  validFrom={horse.insuranceValidFrom}
                  validTo={horse.insuranceValidTo}
                  expired={!!insuranceExpired}
                  expiring={!!insuranceExpiring}
                />
              ),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function VaccinationsPanel({
  rows,
  todayStart,
}: {
  rows: { id: string; label: string; key: string; lastGivenAt: Date | null; nextDueAt: Date; intervalDays: number }[];
  todayStart: Date;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
        No vaccination schedules. Set them up at{" "}
        <Link href="/vaccinations" className="underline">/vaccinations</Link>.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] tracking-wide text-muted-foreground">
          <tr>
            <th className="pb-2">Vaccine</th>
            <th className="pb-2">Last Given</th>
            <th className="pb-2">Next Due</th>
            <th className="pb-2">Interval</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const overdue = v.nextDueAt < todayStart;
            return (
              <tr key={v.id} className="border-t">
                <td className="py-2">{v.label}</td>
                <td className="py-2">{v.lastGivenAt ? formatDate(v.lastGivenAt) : "—"}</td>
                <td className={`py-2 ${overdue ? "font-semibold text-amber-700" : ""}`}>
                  {formatDate(v.nextDueAt)}
                  {overdue ? " · overdue" : ""}
                </td>
                <td className="py-2 text-xs text-muted-foreground">{v.intervalDays} days</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 text-xs text-muted-foreground">
        Record doses + edit schedules at{" "}
        <Link href="/vaccinations" className="underline">/vaccinations</Link>.
      </div>
    </div>
  );
}

function InjuriesPanel({
  rows,
}: {
  rows: { id: string; occurredAt: Date; location: string | null; severity: string; initialNotes: string; status: string }[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
        No injuries logged for this horse.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={r.status === "recovered" ? "success" : r.status === "active" ? "warning" : "outline"}>
              {formatEnum(r.status)}
            </Badge>
            <Badge variant="outline">{formatEnum(r.severity)}</Badge>
            <span className="font-mono text-xs text-muted-foreground">{formatDate(r.occurredAt)}</span>
            {r.location && <span className="text-xs text-muted-foreground">{r.location}</span>}
          </div>
          <div className="mt-1 text-sm">{r.initialNotes}</div>
          <div className="mt-1">
            <Link href={`/injuries`} className="text-xs text-primary underline">
              View full record →
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function FarrierPanel({
  rows,
  todayStart,
}: {
  rows: { id: string; scheduledAt: Date; completedAt: Date | null; workType: string; status: string; nextDueAt: Date | null; farrierName: string }[];
  todayStart: Date;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
        No farrier visits yet. Schedule one at{" "}
        <Link href="/farriery" className="underline">/farriery</Link>.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] tracking-wide text-muted-foreground">
          <tr>
            <th className="pb-2">Date</th>
            <th className="pb-2">Farrier</th>
            <th className="pb-2">Work</th>
            <th className="pb-2">Status</th>
            <th className="pb-2">Next Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const overdue = f.nextDueAt && f.nextDueAt < todayStart;
            return (
              <tr key={f.id} className="border-t">
                <td className="py-2">{formatDate(f.scheduledAt)}</td>
                <td className="py-2">{f.farrierName}</td>
                <td className="py-2 text-xs capitalize">{formatEnum(f.workType)}</td>
                <td className="py-2">
                  <Badge variant={f.status === "completed" ? "success" : f.status === "scheduled" ? "outline" : "warning"}>
                    {formatEnum(f.status)}
                  </Badge>
                </td>
                <td className={`py-2 ${overdue ? "font-semibold text-amber-700" : ""}`}>
                  {f.nextDueAt ? formatDate(f.nextDueAt) : "—"}
                  {overdue ? " · overdue" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InsurancePanel({
  insurer,
  policyNo,
  premium,
  validFrom,
  validTo,
  expired,
  expiring,
}: {
  insurer: string | null;
  policyNo: string | null;
  premium: number | null;
  validFrom: Date | null;
  validTo: Date | null;
  expired: boolean;
  expiring: boolean;
}) {
  const hasAny = insurer || policyNo || premium || validFrom || validTo;
  if (!hasAny) {
    return (
      <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
        No insurance recorded. Edit the horse profile to add policy details.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {insurer ?? "Insurance"}
            {expired && <Badge variant="warning" className="ml-2">EXPIRED</Badge>}
            {expiring && <Badge variant="warning" className="ml-2">expiring soon</Badge>}
          </CardTitle>
          {policyNo && <CardDescription>Policy #{policyNo}</CardDescription>}
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Premium</dt>
            <dd className="col-span-2">
              {premium !== null ? `₹${premium.toLocaleString("en-IN")}` : "—"}
            </dd>
            <dt className="text-muted-foreground">Valid From</dt>
            <dd className="col-span-2">{validFrom ? formatDate(validFrom) : "—"}</dd>
            <dt className="text-muted-foreground">Valid To</dt>
            <dd className={`col-span-2 ${expired ? "font-semibold text-destructive" : expiring ? "font-semibold text-amber-700" : ""}`}>
              {validTo ? formatDate(validTo) : "—"}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
