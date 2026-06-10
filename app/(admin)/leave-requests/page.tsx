import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { LeaveRequestActions, NewLeaveRequestForm } from "./client";

export const dynamic = "force-dynamic";

export default async function LeaveRequestsPage() {
  const session = (await getSession())!;
  const isApprover = can(session.role, "leave.approve");
  const canRequest = can(session.role, "leave.request");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const centreId = scopeCentre(session);
  const baseWhere = tenantWhere(centreId, orgId);
  const where = isApprover ? baseWhere : { ...baseWhere, userId: session.userId };

  const rows = await prisma.leaveRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { user: { select: { id: true, name: true, role: true } } },
    take: 200,
  });

  const pending = rows.filter((r) => r.status === "pending");
  const reviewed = rows.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leave Requests</h1>
        <p className="text-sm text-muted-foreground">
          {isApprover ? "Approve or reject pending leave requests." : "Your leave requests."}
        </p>
      </div>

      {canRequest && (
        <Card>
          <CardHeader>
            <CardTitle>Request leave</CardTitle>
          </CardHeader>
          <CardContent>
            <NewLeaveRequestForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pending ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table rows={pending} isApprover={isApprover} selfUserId={session.userId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviewed ({reviewed.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table rows={reviewed} isApprover={isApprover} selfUserId={session.userId} />
        </CardContent>
      </Card>
    </div>
  );
}

function Table({
  rows,
  isApprover,
  selfUserId,
}: {
  rows: Array<{
    id: string;
    status: string;
    startDate: Date;
    endDate: Date;
    reason: string;
    reviewNotes: string | null;
    userId: string;
    user: { name: string; role: string };
  }>;
  isApprover: boolean;
  selfUserId: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nothing here.</p>;
  }
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="pb-2">Staff</th>
          <th className="pb-2">Window</th>
          <th className="pb-2">Reason</th>
          <th className="pb-2">Status</th>
          <th className="pb-2">Notes</th>
          <th className="pb-2 text-right">Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t align-top">
            <td className="py-2 font-medium">
              {r.user.name}
              <div className="text-xs text-muted-foreground">{r.user.role.replaceAll("_", " ")}</div>
            </td>
            <td className="py-2 whitespace-nowrap">
              {formatDate(r.startDate)} → {formatDate(r.endDate)}
            </td>
            <td className="py-2">{r.reason}</td>
            <td className="py-2">
              <Badge
                variant={
                  r.status === "approved"
                    ? "success"
                    : r.status === "rejected"
                      ? "destructive"
                      : r.status === "cancelled"
                        ? "outline"
                        : "warning"
                }
              >
                {r.status}
              </Badge>
            </td>
            <td className="py-2 text-xs text-muted-foreground">{r.reviewNotes ?? "—"}</td>
            <td className="py-2 text-right">
              <LeaveRequestActions
                id={r.id}
                status={r.status}
                isApprover={isApprover}
                isRequester={r.userId === selfUserId}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}
