import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertRoute } from "@/lib/route-guard";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { TrainingClient } from "./training-client";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  const session = await assertRoute("/training");
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const centreId = scopeCentre(session);
  const canManage = can(session.role, "staff.manage");

  // Course / StaffCertification carry centreId but have no `centre` relation,
  // so tenantWhere ({centre:{orgId}}) doesn't apply — bind by the caller's
  // org's centre-id set instead (a specific in-org centre when one is picked).
  const orgCentreIds = (await prisma.centre.findMany({ where: { orgId }, select: { id: true } })).map((c) => c.id);
  const where: any = { centreId: centreId ?? { in: orgCentreIds } };

  const [courses, certs, staff] = await Promise.all([
    prisma.course.findMany({
      where,
      orderBy: [{ active: "desc" }, { title: "asc" }],
      include: { _count: { select: { enrolments: true, certifications: true } } },
    }),
    prisma.staffCertification.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      take: 100,
    }),
    prisma.user.findMany({
      where: { ...tenantWhere(centreId, orgId), status: "active" },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const userById = new Map(staff.map((u) => [u.id, u]));

  // Highlight certs expiring within 60 days.
  const expiringCutoff = new Date(Date.now() + 60 * 86400000);
  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Staff Training & Certifications</h1>
        <p className="text-sm text-muted-foreground">
          Internal courses your club runs, plus external certifications staff bring in
          (BHS, EFI, vet-tech, first-aid). Expiry-tracked so you don't get caught with
          lapsed coaching credentials.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Active courses" value={courses.filter((c) => c.active).length} />
        <Kpi
          label="Certs issued"
          value={certs.length}
        />
        <Kpi
          label="Expiring (60d)"
          value={certs.filter((c) => c.validUntil && c.validUntil >= now && c.validUntil <= expiringCutoff).length}
          tone="amber"
        />
        <Kpi
          label="Expired"
          value={certs.filter((c) => c.validUntil && c.validUntil < now).length}
          tone="rose"
        />
      </div>

      <TrainingClient
        canManage={canManage}
        courses={courses.map((c) => ({
          id: c.id,
          title: c.title,
          targetRoles: c.targetRoles,
          durationHrs: c.durationHrs,
          passingMark: c.passingMark,
          active: c.active,
          enrolments: c._count.enrolments,
          certifications: c._count.certifications,
        }))}
        staff={staff}
      />

      <Card>
        <CardHeader>
          <CardTitle>Certifications</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={certs}
            getRowKey={(c) => c.id}
            emptyMessage="No certifications recorded yet."
            columns={[
              {
                key: "staff",
                header: "Staff",
                primary: true,
                cell: (c) => (
                  <>
                    <div className="font-medium">{userById.get(c.userId)?.name ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{userById.get(c.userId)?.role ?? ""}</div>
                  </>
                ),
              },
              {
                key: "title",
                header: "Title",
                cell: (c) => (
                  <>
                    <div>{c.title}</div>
                    {c.serialNo && <div className="text-[10px] font-mono text-muted-foreground">{c.serialNo}</div>}
                  </>
                ),
              },
              {
                key: "issuer",
                header: "Issuer",
                className: "text-xs",
                cell: (c) => c.issuer ?? (c.courseId ? "Internal" : "—"),
              },
              {
                key: "issued",
                header: "Issued",
                className: "text-xs",
                cell: (c) => formatDate(c.issuedAt),
              },
              {
                key: "validUntil",
                header: "Valid until",
                cell: (c) => {
                  const expired = c.validUntil && c.validUntil < now;
                  const expSoon = c.validUntil && !expired && c.validUntil <= expiringCutoff;
                  return (
                    <span className={`text-xs ${expired ? "font-semibold text-rose-600" : expSoon ? "font-semibold text-amber-700" : ""}`}>
                      {c.validUntil ? formatDate(c.validUntil) : "—"}
                      {expired && <Badge variant="destructive" className="ml-2 text-[10px]">EXPIRED</Badge>}
                      {expSoon && <Badge variant="warning" className="ml-2 text-[10px]">SOON</Badge>}
                    </span>
                  );
                },
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "amber" | "rose" }) {
  const cls = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-700" : "";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
