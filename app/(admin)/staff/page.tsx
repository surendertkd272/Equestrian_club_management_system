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
          <p className="text-sm text-muted-foreground">{total} member{total === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          {CAN_ONBOARD.includes(session.role) && (
            <Button asChild variant="outline">
              <Link href="/staff/onboarding">
                <Link2 className="h-4 w-4" /> Onboard via Link
              </Link>
            </Button>
          )}
          <Button asChild>
            <Link href="/staff/new">
              <Plus className="h-4 w-4" /> Add Staff
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
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-2">Name</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Phone</th>
                <th className="pb-2">Joined</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="py-2 font-medium">
                    {showProfileLink ? (
                      <Link href={`/staff/${s.id}`} className="text-primary hover:underline">
                        {s.user.name}
                      </Link>
                    ) : (
                      s.user.name
                    )}
                  </td>
                  <td className="py-2">
                    <Badge variant="outline">{s.role.replaceAll("_", " ")}</Badge>
                  </td>
                  <td className="py-2">{s.user.email}</td>
                  <td className="py-2">{s.user.phone ?? "—"}</td>
                  <td className="py-2">{formatDate(s.joiningDate)}</td>
                  <td className="py-2">
                    <Badge variant={s.status === "active" ? "success" : "warning"}>{s.status}</Badge>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    {searchParams.q ? (
                      <>No staff match “{searchParams.q}”.</>
                    ) : (
                      <>
                        No staff yet.{" "}
                        <Link href="/staff/new" className="text-primary underline">
                          Add the first one
                        </Link>
                        .
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          <Pagination total={total} page={page} pageSize={pageSize} />
        </CardContent>
      </Card>
    </div>
  );
}
