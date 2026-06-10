import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { InspectionSheet } from "./sheet";

export const dynamic = "force-dynamic";

const CAN_INSPECT = ["INSPECTION_OFFICER", "SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"];

export default async function InspectionDetailPage({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  if (!CAN_INSPECT.includes(session.role)) redirect("/dashboard");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const centreId = scopeCentre(session);
  const run = await prisma.auditRun.findUnique({
    where: { id: params.id },
    include: { items: { orderBy: [{ area: "asc" }, { label: "asc" }] }, centre: { select: { name: true, orgId: true } } },
  });
  if (!run) notFound();
  // Org-bound ownership: HQ users (centreId=null) must not open another org's
  // audit by id; non-HQ are additionally pinned to their own centre.
  if (run.centre.orgId !== orgId) notFound();
  if (centreId && run.centreId !== centreId) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/inspections">
            <ChevronLeft className="h-4 w-4" /> All audits
          </Link>
        </Button>
        <Badge variant={run.status === "completed" ? "success" : "warning"}>{run.status.replace("_", " ")}</Badge>
      </div>

      <div>
        <h1 className="text-2xl font-bold capitalize">{run.scope.replace("_", " ")} audit</h1>
        <p className="text-sm text-muted-foreground">
          {run.centre.name} · started {formatDate(run.startedAt)}
          {run.completedAt ? ` · completed ${formatDate(run.completedAt)}` : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Checklist</CardTitle>
          <CardDescription>Mark each line pass / fail / N-A, add remarks, then complete the audit.</CardDescription>
        </CardHeader>
        <CardContent>
          <InspectionSheet
            runId={run.id}
            completed={run.status === "completed"}
            summary={run.summary}
            items={run.items.map((i) => ({
              id: i.id,
              area: i.area,
              label: i.label,
              result: i.result,
              remarks: i.remarks,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
