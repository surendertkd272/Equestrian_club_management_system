import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { redirect } from "next/navigation";
import { StaffAttendanceMarker } from "./marker";

export const dynamic = "force-dynamic";

export default async function StaffAttendancePage() {
  const session = (await getSession())!;
  if (!can(session.role, "staff.attendance")) redirect("/dashboard");

  const centreId = scopeCentre(session);
  const where = centreWhere(centreId);

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
        <p className="text-sm text-muted-foreground">PRD §4 Module 2 · last 30 days · {recent.length} rows</p>
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
          <CardTitle>Recent rows</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Staff</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Check-in</th>
                <th className="pb-2">Check-out</th>
                <th className="pb-2">OT (h)</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2">{formatDate(r.date)}</td>
                  <td className="py-2 font-medium">{r.user.name}</td>
                  <td className="py-2">
                    <Badge variant="outline">{r.user.role.replaceAll("_", " ")}</Badge>
                  </td>
                  <td className="py-2">
                    <Badge
                      variant={
                        r.status === "present" ? "success" : r.status === "late" ? "warning" : r.status === "leave" ? "outline" : "destructive"
                      }
                    >
                      {r.status}
                    </Badge>
                  </td>
                  <td className="py-2 font-mono text-xs">
                    {r.checkInAt ? r.checkInAt.toISOString().slice(11, 16) : "—"}
                  </td>
                  <td className="py-2 font-mono text-xs">
                    {r.checkOutAt ? r.checkOutAt.toISOString().slice(11, 16) : "—"}
                  </td>
                  <td className="py-2">{r.overtimeHours ?? "—"}</td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    No staff attendance recorded in the last 30 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table></div>
        </CardContent>
      </Card>
    </div>
  );
}
