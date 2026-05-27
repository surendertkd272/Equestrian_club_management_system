import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { EnrolmentActions } from "./enrolment-actions";

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
  const where = centreWhere(centreId);

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
        <h1 className="text-2xl font-bold">Self-enrolment Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Riders who signed up through the public link. Approve to start their registration
          (raises the ₹ registration invoice) or reject. Staff-created riders skip this queue.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending approval</CardTitle>
          <CardDescription>{pending.length} waiting</CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nothing waiting. New self-enrolments will appear here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Contact</th>
                    <th className="pb-2">School</th>
                    {!centreId && <th className="pb-2">Centre</th>}
                    <th className="pb-2">Signed up</th>
                    <th className="pb-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((r) => (
                    <tr key={r.id} className="border-t align-top">
                      <td className="py-2">
                        <div className="font-medium">{r.firstName} {r.lastName}</div>
                        <div className="text-[11px] text-muted-foreground">DOB {formatDate(r.dob)}</div>
                      </td>
                      <td className="py-2">
                        <div>{r.mobile}</div>
                        {r.email && <div className="text-[11px] text-muted-foreground">{r.email}</div>}
                      </td>
                      <td className="py-2 text-xs">{r.school ?? "—"}</td>
                      {!centreId && <td className="py-2 text-xs">{r.centre.name}</td>}
                      <td className="py-2 text-xs">{formatDate(r.createdAt)}</td>
                      <td className="py-2 text-right">
                        <EnrolmentActions riderId={r.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently processed</CardTitle>
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
                      {r.status.replace("_", " ")}
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
