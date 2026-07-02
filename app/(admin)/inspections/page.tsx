import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { loadInspectionRuns } from "@/lib/inspections";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { StartInspection } from "./start-inspection";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

const CAN_INSPECT = ["INSPECTION_OFFICER", "SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"];

// Manual inspection / audit runs. The INSPECTION_OFFICER (external auditor)
// walks the SOP sheet, marking each line pass/fail with remarks. Admins +
// centre manager can also run one.
export default async function InspectionsPage() {
  const session = (await getSession())!;
  if (!CAN_INSPECT.includes(session.role)) redirect("/dashboard");

  // Data-fetching (org resolution + centre scope + the org-wide-when-no-centre
  // query) lives in loadInspectionRuns so the visibility rule is unit-testable
  // without an RSC render. HQ with no centre picked → org-wide; centre-scoped
  // roles stay pinned to their own centre. See lib/inspections.ts.
  const { orgId, centreId, runs } = await loadInspectionRuns(session);
  if (!orgId) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inspections &amp; Audit</h1>
      </div>

      {centreId ? (
        <StartInspection />
      ) : (
        <Card>
          <CardContent className="py-4 text-center text-sm text-muted-foreground">
            Showing audit runs across all centres in your organisation. Pick a centre from the
            top-bar filter to start a new inspection.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Audit Runs</CardTitle>
          <CardDescription>
            {runs.length} total{centreId ? "" : " · all centres"}
          </CardDescription>
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
              { key: "scope", header: "Scope", cell: (r) => <span className="capitalize">{formatEnum(r.scope)}</span> },
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
                cell: (r) => <Badge variant={r.status === "completed" ? "success" : "warning"}>{formatEnum(r.status)}</Badge>,
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
