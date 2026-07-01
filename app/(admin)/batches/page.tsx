import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { NewBatchForm } from "./new-form";
import { BatchDeleteButton } from "./delete-button";
import { ResponsiveTable } from "@/components/ui/responsive-table";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const session = (await getSession())!;
  // scopeCentre resolves the working centre: explicit topbar cookie pick
  // for HQ admins, session.centreId for centre-scoped users. This is the
  // centre the form POSTs against — for HQ admins it's the cookie pick,
  // not a missing session.centreId.
  const centreId = scopeCentre(session);
  // Org-bound the scope: an HQ user's "all centres" (centreId=null) must still
  // be fenced to their own Organisation, not leak every org's batches.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const where = tenantWhere(centreId, orgId);

  const batches = await prisma.batch.findMany({
    where,
    orderBy: { startTime: "asc" },
    include: {
      _count: { select: { riders: true, attendances: true } },
      centre: { select: { id: true, name: true } },
    },
  });

  // Coaches list for the form dropdown. Filter to the resolved centreId
  // (works for both centre-scoped users + HQ admins who picked a centre
  // via the topbar). When HQ admin hasn't picked a centre, return [].
  const coaches = centreId
    ? await prisma.user.findMany({
        where: { ...tenantWhere(centreId, orgId), role: "COACH", status: "active" },
        select: { id: true, name: true },
      })
    : [];

  // batch.manage holders: SUPER_ADMIN, ADMIN, CENTRE_MANAGER, HEAD_COACH, COACH.
  // Read access to the list is open to everyone the sidebar lets in; only
  // write controls (create form + delete) are gated on the permission so a
  // non-manager who reaches the page by direct URL doesn't see controls that
  // would 403 at the API.
  const canManage = can(session.role, "batch.manage");
  const canCreate = !!centreId && canManage;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Batches</h1>
          <p className="text-sm text-muted-foreground">Recurring class slots assigned to a coach.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className={canManage ? "lg:col-span-2" : "lg:col-span-3"}>
          <Card>
            <CardHeader>
              <CardTitle>All Batches</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveTable
                rows={batches}
                getRowKey={(b) => b.id}
                emptyMessage="No batches yet. Use the form on the right to create one."
                columns={[
                  { key: "name", header: "Name", primary: true, cell: (b) => b.name },
                  { key: "centre", header: "Centre", className: "py-2 text-xs text-muted-foreground", cell: (b) => b.centre.name },
                  { key: "days", header: "Days", cell: (b) => b.dayOfWeek },
                  { key: "time", header: "Time", cell: (b) => <>{b.startTime}–{b.endTime}</> },
                  { key: "level", header: "Level", cell: (b) => b.level ?? "—" },
                  { key: "riders", header: "Riders", cell: (b) => b._count.riders },
                  {
                    key: "actions",
                    header: "",
                    cell: (b) => (
                      <div className="flex items-center justify-end gap-2">
                        <Link className="text-xs text-primary underline" href={`/attendance?batch=${b.id}`}>
                          Mark Attendance →
                        </Link>
                        {canManage && (
                          <BatchDeleteButton id={b.id} name={b.name} riderCount={b._count.riders} />
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
        </div>

        {canManage && (
          <div>
            <Card>
              <CardHeader>
                <CardTitle>New Batch</CardTitle>
              </CardHeader>
              <CardContent>
                <NewBatchForm coaches={coaches} disabled={!canCreate} centreId={centreId} />
                {!canCreate && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Pick a centre from the topbar filter to create batches.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
