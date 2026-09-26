import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { staffAttendanceScope, GROUND_STAFF_ROLES } from "@/lib/staff-attendance-scope";
import { todayYmdForCentre } from "@/lib/centre-tz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { redirect } from "next/navigation";
import { StaffAttendanceMarker } from "./marker";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { formatEnum, roleLabel } from "@/lib/labels";
export const dynamic = "force-dynamic";

export default async function StaffAttendancePage() {
  const session = await requireSession();
  const scope = staffAttendanceScope(session.role);
  if (!scope) redirect("/dashboard");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const centreId = scopeCentre(session);
  const where = tenantWhere(centreId, orgId);
  // A coach marks and sees grooms only — see lib/staff-attendance-scope.ts.
  const roleFilter =
    scope === "all" ? { not: "RIDER" as const } : { in: [...GROUND_STAFF_ROLES] as string[] };

  const sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [recent, staff] = await Promise.all([
    prisma.staffAttendance.findMany({
      where: { ...where, date: { gte: sinceDate }, user: { role: roleFilter } },
      orderBy: [{ date: "desc" }, { user: { name: "asc" } }],
      include: { user: { select: { id: true, name: true, role: true } } },
      take: 200,
    }),
    prisma.user.findMany({
      where: { ...where, status: "active", role: roleFilter },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  // The CENTRE's today, not the server's. This used toISOString() — UTC — so
  // for the first five and a half hours of every Indian day "Mark today"
  // marked yesterday, which is exactly when a 6 am yard is taking its register.
  const todayYMD = await todayYmdForCentre(centreId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {scope === "all" ? "Staff Attendance" : "Grooms' Attendance"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {scope === "all"
            ? `Last 30 days · ${recent.length} rows`
            : `Mark the grooms at your centre each morning · last 30 days · ${recent.length} rows`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mark today ({todayYMD})</CardTitle>
        </CardHeader>
        <CardContent>
          <StaffAttendanceMarker staff={staff} defaultDate={todayYMD} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Rows</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={recent}
            getRowKey={(r) => r.id}
            emptyMessage="No staff attendance recorded in the last 30 days."
            columns={[
              { key: "date", header: "Date", cell: (r) => formatDate(r.date) },
              {
                key: "staff",
                header: "Staff",
                primary: true,
                cell: (r) => <span className="font-medium">{r.user.name}</span>,
              },
              {
                key: "role",
                header: "Role",
                cell: (r) => <Badge variant="outline">{roleLabel(r.user.role)}</Badge>,
              },
              {
                key: "status",
                header: "Status",
                cell: (r) => (
                  <Badge
                    variant={
                      r.status === "present" ? "success" : r.status === "late" ? "warning" : r.status === "leave" ? "outline" : "destructive"
                    }
                  >
                    {formatEnum(r.status)}
                  </Badge>
                ),
              },
              {
                key: "checkIn",
                header: "Check-In",
                cell: (r) => (
                  <span className="font-mono text-xs">
                    {r.checkInAt ? r.checkInAt.toISOString().slice(11, 16) : "—"}
                  </span>
                ),
              },
              {
                key: "checkOut",
                header: "Check-Out",
                cell: (r) => (
                  <span className="font-mono text-xs">
                    {r.checkOutAt ? r.checkOutAt.toISOString().slice(11, 16) : "—"}
                  </span>
                ),
              },
              { key: "ot", header: "OT (h)", cell: (r) => r.overtimeHours ?? "—" },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
