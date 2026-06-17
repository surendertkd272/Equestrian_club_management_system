import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { StartInspection } from "./start-inspection";

export const dynamic = "force-dynamic";

const CAN_INSPECT = ["INSPECTION_OFFICER", "SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"];

// Manual inspection / audit runs. The INSPECTION_OFFICER (external auditor)
// walks the SOP sheet, marking each line pass/fail with remarks. Admins +
// centre manager can also run one.
export default async function InspectionsPage() {
  const session = (await getSession())!;
  if (!CAN_INSPECT.includes(session.role)) redirect("/dashboard");

  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Inspections &amp; Audit</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Pick a centre from the top-bar filter to run an inspection.
          </CardContent>
        </Card>
      </div>
    );
  }

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");

  const runs = await prisma.auditRun.findMany({
    where: tenantWhere(centreId, orgId),
    orderBy: { startedAt: "desc" },
    take: 60,
    include: { items: { select: { result: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inspections &amp; Audit</h1>
        <p className="text-sm text-muted-foreground">
          Run a manual audit of inventory, the vet cabinet, or the stable. Each run seeds a
          standard checklist; mark every line pass / fail with remarks, then complete it.
        </p>
      </div>

      <StartInspection />

      <Card>
        <CardHeader>
          <CardTitle>Audit runs</CardTitle>
          <CardDescription>{runs.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={runs}
            getRowKey={(r) => r.id}
            emptyMessage="No audits yet — start one above."
            columns={[
              {
                key: "started",
                header: "Started",
                primary: true,
                cell: (r) => <span className="text-xs">{formatDate(r.startedAt)}</span>,
              },
              { key: "scope", header: "Scope", cell: (r) => <span className="capitalize">{r.scope.replace("_", " ")}</span> },
              {
                key: "pass",
                header: "Pass",
                headerClassName: "text-center",
                className: "text-center",
                cell: (r) => {
                  const pass = r.items.filter((i) => i.result === "pass").length;
                  return <span className="text-emerald-700">{pass}</span>;
                },
              },
              {
                key: "fail",
                header: "Fail",
                headerClassName: "text-center",
                className: "text-center",
                cell: (r) => {
                  const fail = r.items.filter((i) => i.result === "fail").length;
                  return <span className={fail > 0 ? "font-semibold text-rose-600" : ""}>{fail || "—"}</span>;
                },
              },
              {
                key: "pending",
                header: "Pending",
                headerClassName: "text-center",
                className: "text-center",
                cell: (r) => {
                  const pending = r.items.filter((i) => i.result === "pending").length;
                  return <span className="text-muted-foreground">{pending || "—"}</span>;
                },
              },
              {
                key: "status",
                header: "Status",
                cell: (r) => <Badge variant={r.status === "completed" ? "success" : "warning"}>{r.status.replace("_", " ")}</Badge>,
              },
              {
                key: "open",
                header: "",
                className: "text-right",
                cell: (r) => (
                  <Link href={`/inspections/${r.id}`} className="text-xs text-primary underline">
                    {r.status === "completed" ? "View" : "Continue"} →
                  </Link>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
