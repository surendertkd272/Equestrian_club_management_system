import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessRoute } from "@/components/shell/sidebar-nav";
import { scopeCentre } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { TrainingClient } from "./training-client";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  const session = (await getSession())!;
  if (!canAccessRoute(session.role, "/training")) redirect("/dashboard");
  const centreId = scopeCentre(session);
  const canManage = can(session.role, "staff.manage");

  const where: any = {};
  if (centreId) where.centreId = centreId;

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
      where: centreId ? { centreId, status: "active" } : { status: "active" },
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
          {certs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No certifications recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Staff</th>
                  <th className="px-2 py-2">Title</th>
                  <th className="px-2 py-2">Issuer</th>
                  <th className="px-2 py-2">Issued</th>
                  <th className="px-2 py-2">Valid until</th>
                </tr>
              </thead>
              <tbody>
                {certs.map((c) => {
                  const expired = c.validUntil && c.validUntil < now;
                  const expSoon = c.validUntil && !expired && c.validUntil <= expiringCutoff;
                  return (
                    <tr key={c.id} className="border-t">
                      <td className="px-2 py-2">
                        <div className="font-medium">{userById.get(c.userId)?.name ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{userById.get(c.userId)?.role ?? ""}</div>
                      </td>
                      <td className="px-2 py-2">
                        <div>{c.title}</div>
                        {c.serialNo && <div className="text-[10px] font-mono text-muted-foreground">{c.serialNo}</div>}
                      </td>
                      <td className="px-2 py-2 text-xs">{c.issuer ?? (c.courseId ? "Internal" : "—")}</td>
                      <td className="px-2 py-2 text-xs">{formatDate(c.issuedAt)}</td>
                      <td className={`px-2 py-2 text-xs ${expired ? "font-semibold text-rose-600" : expSoon ? "font-semibold text-amber-700" : ""}`}>
                        {c.validUntil ? formatDate(c.validUntil) : "—"}
                        {expired && <Badge variant="destructive" className="ml-2 text-[10px]">EXPIRED</Badge>}
                        {expSoon && <Badge variant="warning" className="ml-2 text-[10px]">SOON</Badge>}
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

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "amber" | "rose" }) {
  const cls = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-700" : "";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
