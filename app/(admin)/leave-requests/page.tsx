import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { LeaveRequestActions, NewLeaveRequestForm } from "./client";
import { formatEnum, roleLabel } from "@/lib/labels";
export const dynamic = "force-dynamic";

export default async function LeaveRequestsPage() {
  const session = await requireSession();
  const isApprover = can(session.role, "leave.approve");
  const canRequest = can(session.role, "leave.request");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

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
      </div>

      {canRequest && (
        <Card>
          <CardHeader>
            <CardTitle>Request Leave</CardTitle>
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
  return (
    <ResponsiveTable
      rows={rows}
      getRowKey={(r) => r.id}
      emptyMessage="Nothing here."
      columns={[
        {
          key: "staff",
          header: "Staff",
          primary: true,
          cell: (r) => (
            <span className="font-medium">
              {r.user.name}
              <div className="text-xs text-muted-foreground">{roleLabel(r.user.role)}</div>
            </span>
          ),
        },
        {
          key: "window",
          header: "Window",
          cell: (r) => (
            <span className="whitespace-nowrap">
              {formatDate(r.startDate)} → {formatDate(r.endDate)}
            </span>
          ),
        },
        { key: "reason", header: "Reason", cell: (r) => r.reason },
        {
          key: "status",
          header: "Status",
          cell: (r) => (
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
              {formatEnum(r.status)}
            </Badge>
          ),
        },
        {
          key: "notes",
          header: "Notes",
          cell: (r) => <span className="text-xs text-muted-foreground">{r.reviewNotes ?? "—"}</span>,
        },
        {
          key: "action",
          header: "Action",
          cell: (r) => (
            <LeaveRequestActions
              id={r.id}
              status={r.status}
              isApprover={isApprover}
              isRequester={r.userId === selfUserId}
            />
          ),
        },
      ]}
    />
  );
}
