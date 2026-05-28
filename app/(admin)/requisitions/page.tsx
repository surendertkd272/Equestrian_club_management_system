import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { RequisitionList, type RequisitionDTO } from "./requisition-list";

export const dynamic = "force-dynamic";

const STAGE_BADGE: Record<string, { label: string; variant: "warning" | "success" | "destructive" | "outline" }> = {
  pending_manager: { label: "Pending manager", variant: "warning" },
  pending_accountant: { label: "Pending accountant", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
};

export default async function RequisitionsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "requisition.submit")) redirect("/dashboard");

  const centreId = scopeCentre(session);
  const where = centreWhere(centreId);

  const canApproveManager = can(session.role, "requisition.approve_manager");
  const canApproveAccountant = can(session.role, "requisition.approve_accountant");

  // Three buckets: my own submissions, the manager queue (only if I can
  // approve there), and the accountant queue (ditto). The same row can
  // legitimately appear in both my-submissions AND a queue if I'm both
  // submitter and approver — that's fine; the UI labels each bucket.
  const [mine, mgrQueue, accQueue] = await Promise.all([
    prisma.requisition.findMany({
      where: { ...where, requestedByUserId: session.userId },
      include: { requestedBy: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    canApproveManager
      ? prisma.requisition.findMany({
          where: { ...where, stage: "pending_manager" },
          include: { requestedBy: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: "asc" },
          take: 50,
        })
      : Promise.resolve([]),
    canApproveAccountant
      ? prisma.requisition.findMany({
          where: { ...where, stage: "pending_accountant" },
          include: { requestedBy: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: "asc" },
          take: 50,
        })
      : Promise.resolve([]),
  ]);

  function toDTO(rows: typeof mine): RequisitionDTO[] {
    return rows.map((r) => ({
      id: r.id,
      stage: r.stage,
      // itemsJson is a jsonb column — already-parsed by Prisma. Cast to the
      // DTO shape we know was written.
      items: (Array.isArray(r.itemsJson) ? r.itemsJson : []) as RequisitionDTO["items"],
      totalEstimatedCost: r.totalEstimatedCost,
      reason: r.reason,
      managerNotes: r.managerNotes,
      accountantNotes: r.accountantNotes,
      rejectedReason: r.rejectedReason,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt.toISOString(),
      managerDecidedAt: r.managerDecidedAt?.toISOString() ?? null,
      accountantDecidedAt: r.accountantDecidedAt?.toISOString() ?? null,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Requisitions</h1>
          <p className="text-sm text-muted-foreground">
            Procurement requests — staff submits, manager approves, accountant signs off.
          </p>
        </div>
        <Button asChild>
          <Link href="/requisitions/new">
            <Plus className="mr-1 h-4 w-4" /> New requisition
          </Link>
        </Button>
      </div>

      {canApproveManager && (
        <Card>
          <CardHeader>
            <CardTitle>
              Pending your manager approval{" "}
              <span className="text-sm font-normal text-muted-foreground">({mgrQueue.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RequisitionList rows={toDTO(mgrQueue)} mode="manager" />
          </CardContent>
        </Card>
      )}

      {canApproveAccountant && (
        <Card>
          <CardHeader>
            <CardTitle>
              Pending your accountant signoff{" "}
              <span className="text-sm font-normal text-muted-foreground">({accQueue.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RequisitionList rows={toDTO(accQueue)} mode="accountant" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Your submissions{" "}
            <span className="text-sm font-normal text-muted-foreground">({mine.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mine.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              You haven't raised any requisitions yet.
            </p>
          ) : (
            <RequisitionList rows={toDTO(mine)} mode="readonly" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
