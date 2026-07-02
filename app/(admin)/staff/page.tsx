import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Link2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Pagination } from "@/components/ui/pagination";
import { parsePaging } from "@/lib/paging";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { formatEnum, roleLabel } from "@/lib/labels";
export const dynamic = "force-dynamic";

const CAN_ONBOARD = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"];

// Profile + printable packet are an admin / super-admin tool.
function canViewProfile(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string; pageSize?: string };
}) {
  const session = (await getSession())!;
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const centreId = scopeCentre(session);
  const where: any = { ...tenantWhere(centreId, orgId) };
  if (searchParams.q) {
    where.OR = [
      { user: { name: { contains: searchParams.q } } },
      { user: { email: { contains: searchParams.q } } },
      { user: { phone: { contains: searchParams.q } } },
      { role: { contains: searchParams.q } },
    ];
  }
  const showProfileLink = canViewProfile(session.role);

  const { page, pageSize, skip, take } = parsePaging(searchParams, { pageSize: 25 });
  const [total, staff] = await Promise.all([
    prisma.staff.count({ where }),
    prisma.staff.findMany({
      where,
      include: { user: { select: { name: true, email: true, phone: true, status: true } } },
      orderBy: { joiningDate: "desc" },
      skip,
      take,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Staff</h1>
        </div>
        <div className="flex items-center gap-2">
          {CAN_ONBOARD.includes(session.role) && (
            <Button asChild variant="outline">
              <Link href="/staff/onboarding">
                <Link2 className="h-4 w-4" /> Onboard via link
              </Link>
            </Button>
          )}
          <Button asChild>
            <Link href="/staff/new">
              <Plus className="h-4 w-4" /> Add staff
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Staff</CardTitle>
          <form className="mt-2 flex gap-2">
            <input
              type="search"
              name="q"
              aria-label="Search staff by name, email, phone, or role"
              defaultValue={searchParams.q ?? ""}
              placeholder="Search name, email, phone, role"
              className="flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-base md:text-sm"
            />
            <Button type="submit" variant="outline" size="sm">Search</Button>
          </form>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={staff}
            getRowKey={(s) => s.id}
            emptyMessage={
              searchParams.q ? (
                <>No staff match “{searchParams.q}”.</>
              ) : (
                <>
                  No staff yet.{" "}
                  <Link href="/staff/new" className="text-primary underline">
                    Add the first one
                  </Link>
                  .
                </>
              )
            }
            columns={[
              {
                key: "name",
                header: "Name",
                primary: true,
                cell: (s) =>
                  showProfileLink ? (
                    <Link href={`/staff/${s.id}`} className="text-primary hover:underline">
                      {s.user.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{s.user.name}</span>
                  ),
              },
              { key: "role", header: "Role", cell: (s) => <Badge variant="outline">{roleLabel(s.role)}</Badge> },
              { key: "email", header: "Email", cell: (s) => s.user.email },
              { key: "phone", header: "Phone", cell: (s) => s.user.phone ?? "—" },
              { key: "joined", header: "Joined", cell: (s) => formatDate(s.joiningDate) },
              { key: "status", header: "Status", cell: (s) => <Badge variant={s.status === "active" ? "success" : "warning"}>{formatEnum(s.status)}</Badge> },
            ]}
          />
          <Pagination total={total} page={page} pageSize={pageSize} />
        </CardContent>
      </Card>
    </div>
  );
}
