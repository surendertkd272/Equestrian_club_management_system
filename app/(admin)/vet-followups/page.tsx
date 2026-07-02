// Cross-horse vet follow-up calendar. The vet uses this to plan their
// week; the centre manager uses it as a "is anything getting missed?"
// roll-up. Lists VetVisit rows that have a non-null followUpAt, grouped
// by overdue / this week / next 30 days.

import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { startOfDayInTz } from "@/lib/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function VetFollowupsPage() {
  const session = (await getSession())!;
  // VET can see all their centre's follow-ups; managers + horse.manage roles
  // can too (so a head coach can spot a horse that's been off-roster too long).
  if (!can(session.role, "medicine.prescribe") && !can(session.role, "horse.manage")) {
    redirect("/dashboard");
  }
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const centreId = scopeCentre(session);

  // Partition by the centre's local day, not the server's UTC instant — a
  // follow-up due today shouldn't read as "overdue". Single-centre → that
  // centre's zone; HQ all-centres aggregate → IST default.
  const tz = centreId
    ? (await prisma.centre.findUnique({ where: { id: centreId }, select: { timezone: true } }))?.timezone ?? "Asia/Kolkata"
    : "Asia/Kolkata";
  const todayStart = startOfDayInTz(new Date(), tz);
  const horizon = new Date(Date.now() + 60 * 86400000); // 60d ahead window

  const visits = await prisma.vetVisit.findMany({
    where: {
      ...tenantWhere(centreId, orgId),
      followUpAt: { not: null, lte: horizon },
    },
    include: {
      horse: { select: { id: true, name: true, stableNo: true } },
      vet: { select: { id: true, name: true } },
      prescriptions: { select: { medicineName: true, dose: true } },
    },
    orderBy: { followUpAt: "asc" },
  });

  const weekEnd = new Date(todayStart.getTime() + 7 * 86400000);
  const overdue = visits.filter((v) => v.followUpAt! < todayStart);
  const thisWeek = visits.filter((v) => v.followUpAt! >= todayStart && v.followUpAt! <= weekEnd);
  const later = visits.filter((v) => v.followUpAt! > weekEnd);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Vet Follow-Ups</h1>
      </div>

      <Section title="Overdue" badge="destructive" empty="Nothing overdue — good." visits={overdue} highlight />
      <Section title="This week" badge="warning" empty="Nothing scheduled this week." visits={thisWeek} />
      <Section title="Next 30+ days" badge="outline" empty="Nothing on the horizon." visits={later} />
    </div>
  );
}

type Visit = Awaited<ReturnType<typeof prisma.vetVisit.findMany>>[number] & {
  horse: { id: string; name: string; stableNo: string | null };
  vet: { id: string; name: string };
  prescriptions: { medicineName: string; dose: string }[];
};

function Section({
  title,
  badge,
  visits,
  empty,
  highlight,
}: {
  title: string;
  badge: "destructive" | "warning" | "outline";
  visits: Visit[];
  empty: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight && visits.length > 0 ? "border-destructive/40" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <Badge variant={badge}>{visits.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {visits.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ol className="space-y-2">
            {visits.map((v) => (
              <li key={v.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/horses/${v.horse.id}`} className="font-semibold hover:underline">
                    {v.horse.name}
                    {v.horse.stableNo && <span className="ml-1 text-xs font-normal text-muted-foreground">/ {v.horse.stableNo}</span>}
                  </Link>
                  <span className="text-sm font-medium">{formatDate(v.followUpAt!)}</span>
                </div>
                {v.reason && (
                  <div className="mt-1 text-xs text-muted-foreground">Reason: {v.reason}</div>
                )}
                {v.prescriptions.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    On: {v.prescriptions.map((p) => `${p.medicineName} ${p.dose}`).join(", ")}
                  </div>
                )}
                <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Last seen by {v.vet.name} on {formatDate(v.visitDate)}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
