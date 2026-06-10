import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
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
          {runs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No audits yet — start one above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2">Started</th>
                    <th className="pb-2">Scope</th>
                    <th className="pb-2 text-center">Pass</th>
                    <th className="pb-2 text-center">Fail</th>
                    <th className="pb-2 text-center">Pending</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const pass = r.items.filter((i) => i.result === "pass").length;
                    const fail = r.items.filter((i) => i.result === "fail").length;
                    const pending = r.items.filter((i) => i.result === "pending").length;
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="py-2 text-xs">{formatDate(r.startedAt)}</td>
                        <td className="py-2 capitalize">{r.scope.replace("_", " ")}</td>
                        <td className="py-2 text-center text-emerald-700">{pass}</td>
                        <td className={`py-2 text-center ${fail > 0 ? "font-semibold text-rose-600" : ""}`}>{fail || "—"}</td>
                        <td className="py-2 text-center text-muted-foreground">{pending || "—"}</td>
                        <td className="py-2">
                          <Badge variant={r.status === "completed" ? "success" : "warning"}>{r.status.replace("_", " ")}</Badge>
                        </td>
                        <td className="py-2 text-right">
                          <Link href={`/inspections/${r.id}`} className="text-xs text-primary underline">
                            {r.status === "completed" ? "View" : "Continue"} →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
