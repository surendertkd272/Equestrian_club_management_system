import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { BookingsClient } from "./bookings-client";
import { formatEnum } from "@/lib/labels";
import { sameLocalDay } from "@/lib/tz";
export const dynamic = "force-dynamic";

export default async function FacilityBookingsPage() {
  const session = await requireSession();
  const centreId = scopeCentre(session);
  const canBook = can(session.role, "staff.manage");

  // Org-bound so an HQ user's "all centres" (centreId=null) can't fall through
  // to an empty filter that leaks every org's bookings. Fail closed if the org
  // can't be resolved.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  // FacilityBooking has a scalar centreId but NO `centre` relation, so the
  // tenantWhere() relation-filter can't bind it — constrain to the org's own
  // centres instead. A specific HQ pick narrows to that centre.
  // Timezone comes along for the ride: this page renders booking times, and
  // this is a SERVER component, so a bare toLocaleString() formats in the
  // server's zone — UTC on Vercel — showing every Indian booking ~5.5h out.
  const orgCentres = await prisma.centre.findMany({
    where: { orgId },
    select: { id: true, timezone: true },
  });
  const orgCentreIds = orgCentres.map((c) => c.id);
  const tzByCentre = new Map(orgCentres.map((c) => [c.id, c.timezone]));
  const fallbackTz = orgCentres[0]?.timezone ?? "Asia/Kolkata";
  // Each booking is formatted in ITS OWN centre's zone — an HQ user looking at
  // "all centres" is otherwise reading several zones rendered as one.
  const tzFor = (r: { centreId: string | null }) =>
    (r.centreId ? tzByCentre.get(r.centreId) : null) ?? fallbackTz;
  const fmt = (at: Date, tz: string) =>
    new Date(at).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    });

  const where: any = {
    endAt: { gte: new Date(Date.now() - 7 * 86400000) },
    centreId: centreId && orgCentreIds.includes(centreId) ? centreId : { in: orgCentreIds },
  };

  const [rows, facilities] = await Promise.all([
    prisma.facilityBooking.findMany({
      where,
      orderBy: { startAt: "asc" },
      take: 200,
    }),
    // Facility carries a `centre` relation, so org scope binds through it.
    prisma.facility.findMany({
      where: tenantWhere(centreId, orgId),
      select: { id: true, name: true, type: true, capacity: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const facById = new Map(facilities.map((f) => [f.id, f]));
  const now = new Date();
  const upcoming = rows.filter((r) => r.startAt >= now);
  // Same bug, second form: toDateString() is server-local, so "today's
  // bookings" was computed against a UTC calendar day. A 07:00 IST booking
  // falls on the previous UTC day and vanished from the list.
  const today = rows.filter((r) => sameLocalDay(new Date(r.startAt), now, tzFor(r)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Facility Bookings</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Facilities" value={facilities.length} />
        <Kpi label="Bookings (Last 7d + Future)" value={rows.length} />
        <Kpi label="Today" value={today.length} />
        <Kpi label="Upcoming" value={upcoming.length} />
      </div>

      <BookingsClient canBook={canBook} facilities={facilities} />

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={rows}
            getRowKey={(r) => r.id}
            emptyMessage="No bookings on the books — start a new one above."
            columns={[
              {
                key: "when",
                header: "When",
                primary: true,
                cell: (r) => (
                  <div className="text-xs">
                    <div className="font-medium">{fmt(r.startAt, tzFor(r))}</div>
                    <div className="text-muted-foreground">
                      → {fmt(r.endAt, tzFor(r))}
                    </div>
                  </div>
                ),
              },
              {
                key: "facility",
                header: "Facility",
                cell: (r) => {
                  const fac = facById.get(r.facilityId);
                  return (
                    <>
                      <div className="font-medium">{fac?.name ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground">{fac?.type ?? ""}</div>
                    </>
                  );
                },
              },
              { key: "purpose", header: "Purpose", cell: (r) => <span className="text-xs capitalize">{formatEnum(r.purpose)}</span> },
              { key: "title", header: "Title", cell: (r) => <span className="text-sm">{r.title}</span> },
              {
                key: "status",
                header: "Status",
                cell: (r) => {
                  const past = r.endAt < now;
                  const inProgress = r.startAt <= now && r.endAt >= now;
                  return (
                    <>
                      {inProgress && <Badge variant="success">in progress</Badge>}
                      {past && <Badge variant="outline">past</Badge>}
                      {!past && !inProgress && <Badge variant="warning">scheduled</Badge>}
                    </>
                  );
                },
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
