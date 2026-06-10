import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { NewBatchForm } from "./new-form";
import { BatchDeleteButton } from "./delete-button";

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

  const canCreate = !!centreId;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Batches</h1>
          <p className="text-sm text-muted-foreground">Recurring class slots assigned to a coach.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>All Batches</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Centre</th>
                    <th className="pb-2">Days</th>
                    <th className="pb-2">Time</th>
                    <th className="pb-2">Level</th>
                    <th className="pb-2">Riders</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-t">
                      <td className="py-2 font-medium">{b.name}</td>
                      <td className="py-2 text-xs text-muted-foreground">{b.centre.name}</td>
                      <td className="py-2">{b.dayOfWeek}</td>
                      <td className="py-2">
                        {b.startTime}–{b.endTime}
                      </td>
                      <td className="py-2">{b.level ?? "—"}</td>
                      <td className="py-2">{b._count.riders}</td>
                      <td className="py-2">
                        <div className="flex items-center justify-end gap-2">
                          <Link className="text-xs text-primary underline" href={`/attendance?batch=${b.id}`}>
                            Mark attendance →
                          </Link>
                          <BatchDeleteButton id={b.id} name={b.name} riderCount={b._count.riders} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {batches.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No batches yet. Use the form on the right to create one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>
        </div>

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
      </div>
    </div>
  );
}
