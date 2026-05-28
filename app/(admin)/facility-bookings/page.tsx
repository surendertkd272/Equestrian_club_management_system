import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookingsClient } from "./bookings-client";

export const dynamic = "force-dynamic";

export default async function FacilityBookingsPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const canBook = can(session.role, "staff.manage");

  const where: any = { endAt: { gte: new Date(Date.now() - 7 * 86400000) } };
  if (centreId) where.centreId = centreId;

  const [rows, facilities] = await Promise.all([
    prisma.facilityBooking.findMany({
      where,
      orderBy: { startAt: "asc" },
      take: 200,
    }),
    prisma.facility.findMany({
      where: centreId ? { centreId } : {},
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
        <p className="text-sm text-muted-foreground">
          Reserve arenas, classrooms, and stables. Overlapping bookings on the same facility
          are refused automatically — back-to-back slots (09:00→10:00 then 10:00→11:00) are
          fine.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Facilities" value={facilities.length} />
        <Kpi label="Bookings (last 7d + future)" value={rows.length} />
        <Kpi label="Today" value={today.length} />
        <Kpi label="Upcoming" value={upcoming.length} />
      </div>

      <BookingsClient canBook={canBook} facilities={facilities} />

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No bookings on the books — start a new one above.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">When</th>
                  <th className="px-2 py-2">Facility</th>
                  <th className="px-2 py-2">Purpose</th>
                  <th className="px-2 py-2">Title</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const fac = facById.get(r.facilityId);
                  const past = r.endAt < now;
                  const inProgress = r.startAt <= now && r.endAt >= now;
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-2 py-2 text-xs">
                        <div className="font-medium">{new Date(r.startAt).toLocaleString()}</div>
                        <div className="text-muted-foreground">
                          → {new Date(r.endAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-medium">{fac?.name ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{fac?.type ?? ""}</div>
                      </td>
                      <td className="px-2 py-2 text-xs capitalize">{r.purpose}</td>
                      <td className="px-2 py-2 text-sm">{r.title}</td>
                      <td className="px-2 py-2">
                        {inProgress && <Badge variant="success">in progress</Badge>}
                        {past && <Badge variant="outline">past</Badge>}
                        {!past && !inProgress && <Badge variant="warning">scheduled</Badge>}
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

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
