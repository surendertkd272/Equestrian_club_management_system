import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewTaskForm } from "./form";

// force-dynamic so the user list never comes from a cached SSR render —
// users get added throughout the day and a stale dropdown ('I just
// created Bob, why isn't he showing?') surfaced as 'empty until I
// hard refresh' in QA.
export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const session = (await getSession())!;
  if (!can(session.role, "task.assign")) redirect("/tasks");

  // For HQ admins (SUPER_ADMIN / ADMIN with no session.centreId), the
  // form shows a centre picker AND needs every centre's staff — the
  // picker filters the roster client-side. For centre-scoped users we
  // narrow to their pinned centre.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const resolvedCentreId = scopeCentre(session);
  const isHQ = (session.role === "SUPER_ADMIN" || session.role === "ADMIN") && !session.centreId;

  const [users, allCentres] = await Promise.all([
    prisma.user.findMany({
      where: {
        status: "active",
        // Org-bound: HQ ("all centres") still limited to its own org's staff.
        ...tenantWhere(isHQ ? null : resolvedCentreId, orgId),
      },
      select: { id: true, name: true, role: true, centreId: true },
      orderBy: { name: "asc" },
    }),
    isHQ
      ? prisma.centre.findMany({
          where: { orgId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  // Default the form's centre picker to the topbar-cookie pick when set —
  // keeps 'I picked Equiwings Gurgaon' honoured here instead of resetting
  // to alphabetically-first centre.
  const initialCentreId = isHQ ? resolvedCentreId ?? allCentres[0]?.id ?? "" : "";

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>New task</CardTitle>
          <CardDescription>
            Assign operational work — stable cleaning, feeding, farrier, vet follow-up. Overdue tasks turn amber, and
            anything more than 24h overdue is auto-flagged "escalated".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewTaskForm users={users} centres={allCentres} initialCentreId={initialCentreId} />
        </CardContent>
      </Card>
    </div>
  );
}
