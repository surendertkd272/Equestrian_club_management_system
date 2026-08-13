import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertRoute } from "@/lib/route-guard";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

// Centre-/HQ-wide list of every rider accreditation. Useful to verify
// federation membership before letting a rider enter a national-scope
// competition.
export default async function AccreditationsListPage({
  searchParams,
}: {
  searchParams: { body?: string; status?: string };
}) {
  const session = await assertRoute("/accreditations");
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const where: any = {};
  where.rider = tenantWhere(centreId, orgId);
  if (searchParams.body) where.body = searchParams.body;
  if (searchParams.status) where.status = searchParams.status;

  const [accs, bodies] = await Promise.all([
    prisma.accreditation.findMany({
      where,
      include: { rider: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { issuedAt: "desc" },
      take: 200,
    }),
    // Pulls the unique list of bodies in scope so the filter chips work.
    prisma.accreditation.findMany({
      where: { rider: tenantWhere(centreId, orgId) },
      select: { body: true },
      distinct: ["body"],
    }),
  ]);

  // Quick rollup — count per body × status.
  const byBody = new Map<string, { active: number; expired: number; revoked: number }>();
  for (const a of accs) {
    if (!byBody.has(a.body)) byBody.set(a.body, { active: 0, expired: 0, revoked: 0 });
    const row = byBody.get(a.body)!;
    if (a.status === "active") row.active++;
    else if (a.status === "expired") row.expired++;
    else if (a.status === "revoked") row.revoked++;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Accreditations</h1>
      </div>

      {byBody.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Rollup by Issuing Body</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2">Body</th>
                    <th className="pb-2">Active</th>
                    <th className="pb-2">Expired</th>
                    <th className="pb-2">Revoked</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(byBody.entries()).map(([b, c]) => (
                    <tr key={b} className="border-t">
                      <td className="py-2 font-medium">{b}</td>
                      <td className="py-2"><Badge variant="success">{c.active}</Badge></td>
                      <td className="py-2"><Badge variant="warning">{c.expired}</Badge></td>
                      <td className="py-2"><Badge variant="destructive">{c.revoked}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Body</label>
              <select aria-label="Filter by body"
                name="body"
                defaultValue={searchParams.body ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {bodies.map((b) => (
                  <option key={b.body} value={b.body}>{b.body}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Status</label>
              <select aria-label="Filter by status"
                name="status"
                defaultValue={searchParams.status ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="revoked">Revoked</option>
              </select>
            </div>
            <button type="submit" className="h-9 rounded-md border bg-card px-3 text-sm hover:bg-muted">Filter</button>
          </form>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={accs}
            getRowKey={(a) => a.id}
            emptyMessage={
              <>No accreditations recorded yet. Add them from a rider&apos;s profile.</>
            }
            columns={[
              {
                key: "rider",
                header: "Rider",
                primary: true,
                cell: (a) => (
                  <Link href={`/riders/${a.rider.id}`} className="hover:underline">
                    {a.rider.firstName} {a.rider.lastName}
                  </Link>
                ),
              },
              { key: "body", header: "Body", className: "font-medium", cell: (a) => a.body },
              { key: "title", header: "Title", cell: (a) => a.title },
              { key: "discipline", header: "Discipline", className: "text-xs", cell: (a) => a.discipline ?? "—" },
              { key: "issued", header: "Issued", cell: (a) => formatDate(a.issuedAt) },
              { key: "expires", header: "Expires", cell: (a) => (a.expiresAt ? formatDate(a.expiresAt) : "—") },
              {
                key: "status",
                header: "Status",
                cell: (a) => (
                  <Badge
                    variant={
                      a.status === "active" ? "success" : a.status === "expired" ? "warning" : "destructive"
                    }
                  >
                    {formatEnum(a.status)}
                  </Badge>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
