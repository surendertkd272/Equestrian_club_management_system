import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { EnrolmentActions } from "./enrolment-actions";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

const APPROVER_ROLES = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "SCHOOL_ADMINISTRATOR"];

// Approval queue for public self-enrolments. Riders who signed up via the
// onboarding link sit in status="pending_approval" until a School Admin /
// Centre Manager approves (→ pending_payment + registration invoice) or
// rejects them.
export default async function EnrolmentsPage() {
  const session = (await getSession())!;
  if (!APPROVER_ROLES.includes(session.role)) redirect("/dashboard");

  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const where = tenantWhere(centreId, orgId);

  const [pending, recent] = await Promise.all([
    prisma.rider.findMany({
      where: { ...where, status: "pending_approval", selfEnrolled: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, firstName: true, lastName: true, dob: true, mobile: true, email: true,
        school: true, addressPresent: true, pincode: true, createdAt: true,
        centre: { select: { name: true } },
      },
    }),
    prisma.rider.findMany({
      where: { ...where, selfEnrolled: true, status: { in: ["pending_payment", "active", "rejected"] } },
      orderBy: { approvedAt: "desc" },
      take: 15,
      select: { id: true, firstName: true, lastName: true, status: true, approvedAt: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Self-Enrolment Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Riders who signed up through the public link. Approve to start their registration
          (raises the ₹ registration invoice) or reject. Staff-created riders skip this queue.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Approval</CardTitle>
          <CardDescription>{pending.length} waiting</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={pending}
            getRowKey={(r) => r.id}
            emptyMessage="Nothing waiting. New self-enrolments will appear here."
            columns={[
              {
                key: "name",
                header: "Name",
                primary: true,
                cell: (r) => (
                  <>
                    <div className="font-medium">{r.firstName} {r.lastName}</div>
                    <div className="text-[11px] text-muted-foreground">DOB {formatDate(r.dob)}</div>
                  </>
                ),
              },
              {
                key: "contact",
                header: "Contact",
                cell: (r) => (
                  <>
                    <div>{r.mobile}</div>
                    {r.email && <div className="text-[11px] text-muted-foreground">{r.email}</div>}
                  </>
                ),
              },
              { key: "school", header: "School", cell: (r) => <span className="text-xs">{r.school ?? "—"}</span> },
              ...(!centreId
                ? [{ key: "centre", header: "Centre", cell: (r: (typeof pending)[number]) => <span className="text-xs">{r.centre.name}</span> }]
                : []),
              { key: "signedUp", header: "Signed Up", cell: (r) => <span className="text-xs">{formatDate(r.createdAt)}</span> },
              {
                key: "action",
                header: "Action",
                headerClassName: "text-right",
                cell: (r) => <EnrolmentActions riderId={r.id} />,
              },
            ]}
          />
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently Processed</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span>{r.firstName} {r.lastName}</span>
                  <span className="flex items-center gap-2">
                    <Badge
                      variant={r.status === "rejected" ? "destructive" : r.status === "active" ? "success" : "outline"}
                    >
                      {formatEnum(r.status)}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {r.approvedAt ? formatDate(r.approvedAt) : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
