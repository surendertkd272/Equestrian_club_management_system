import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditStaffForm } from "./edit-staff-form";

export const dynamic = "force-dynamic";

// Edit a staff member's HR-record fields. Role / email / account status stay on
// the HQ Users admin page — see the note + link below.
export default async function EditStaffPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "staff.manage")) redirect(`/staff/${params.id}`);

  // Tenant scope: centre-scoped users only their own centre; HQ (centreId null)
  // bounded to their own org. Fail closed if the org can't be resolved.
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const staff = await prisma.staff.findFirst({
    where: { id: params.id, ...tenantWhere(centreId, orgId) },
    include: { user: { select: { name: true, email: true, phone: true } } },
  });
  if (!staff) notFound();

  const initial = {
    name: staff.user.name,
    phone: staff.user.phone ?? "",
    salaryBand: staff.salaryBand ?? "",
    joiningDate: staff.joiningDate.toISOString().slice(0, 10),
  };

  return (
    <div className="space-y-6">
      <Link href={`/staff/${staff.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to profile
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Edit Staff</h1>
        <p className="text-sm text-muted-foreground">{staff.user.name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff Details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditStaffForm
            id={staff.id}
            initial={initial}
            userId={staff.userId}
            // Password reset rides on the HQ users endpoint, which is
            // SUPER_ADMIN-only — hide the control for everyone else.
            canResetPassword={session.role === "SUPER_ADMIN"}
          />
          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            To change this person&apos;s email, role, or account status, use the{" "}
            <Link href="/users" className="text-primary underline">
              Users
            </Link>{" "}
            admin page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
