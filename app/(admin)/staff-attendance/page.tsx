import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { redirect } from "next/navigation";
import { StaffAttendanceMarker } from "./marker";
import { ResponsiveTable } from "@/components/ui/responsive-table";

export const dynamic = "force-dynamic";

export default async function StaffAttendancePage() {
  const session = (await getSession())!;
  if (!can(session.role, "staff.attendance")) redirect("/dashboard");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const centreId = scopeCentre(session);
  const where = tenantWhere(centreId, orgId);

  const sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [recent, staff] = await Promise.all([
    prisma.staffAttendance.findMany({
      where: { ...where, date: { gte: sinceDate } },
      orderBy: [{ date: "desc" }, { user: { name: "asc" } }],
      include: { user: { select: { id: true, name: true, role: true } } },
      take: 200,
    }),
    prisma.user.findMany({
      where: { ...where, status: "active", role: { not: "RIDER" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  const todayYMD = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Staff Attendance</h1>
        <p className="text-sm text-muted-foreground">Last 30 days · {recent.length} rows</p>
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
                cell: (r) => <Badge variant="outline">{r.user.role.replaceAll("_", " ")}</Badge>,
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
                    {r.status}
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
