import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { BookingsClient } from "./bookings-client";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

export default async function FacilityBookingsPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const canBook = can(session.role, "staff.manage");

  // Org-bound so an HQ user's "all centres" (centreId=null) can't fall through
  // to an empty filter that leaks every org's bookings. Fail closed if the org
  // can't be resolved.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  // FacilityBooking has a scalar centreId but NO `centre` relation, so the
  // tenantWhere() relation-filter can't bind it — constrain to the org's own
  // centres instead. A specific HQ pick narrows to that centre.
  const orgCentreIds = (
    await prisma.centre.findMany({ where: { orgId }, select: { id: true } })
  ).map((c) => c.id);

  const where: any = {
    endAt: { gte: new Date(Date.now() - 7 * 86400000) },
    centreId: centreId ?? { in: orgCentreIds },
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
  const today = rows.filter((r) => {
    const start = new Date(r.startAt);
    return start.toDateString() === now.toDateString();
  });

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
                    <div className="font-medium">{new Date(r.startAt).toLocaleString()}</div>
                    <div className="text-muted-foreground">
                      → {new Date(r.endAt).toLocaleString()}
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
