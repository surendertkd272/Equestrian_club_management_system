import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertRoute } from "@/lib/route-guard";
import { isReadOnly } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Plus, Users } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { parsePaging } from "@/lib/paging";
import { RidersTable } from "./riders-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportCsvButton } from "@/components/ui/export-csv";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

const statusVariant = (s: string) =>
  s === "active" ? "success" : s === "pending_payment" ? "warning" : s === "suspended" ? "destructive" : "outline";


export default async function RidersPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string; pageSize?: string };
}) {
  // Role gate: the sidebar hides /riders from roles not in its perm list, but
  // that only HID the link — the page itself had no guard, so VET/ACCOUNTANT
  // etc. could read minor-rider PII by typing the URL. assertRoute enforces the
  // nav perm server-side (redirects disallowed roles to /dashboard).
  const session = await assertRoute("/riders");
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const centreId = scopeCentre(session);
  const where: any = { ...tenantWhere(centreId, orgId) };
  // "All statuses" means all CURRENT riders — someone who left the club two
  // years ago shouldn't be padding out the roll every time you open the page.
  // They're one filter selection away, never gone.
  if (searchParams.status) where.status = searchParams.status;
  else where.status = { not: "withdrawn" };
  if (searchParams.q) {
    where.OR = [
      { firstName: { contains: searchParams.q } },
      { lastName: { contains: searchParams.q } },
      { mobile: { contains: searchParams.q } },
      { email: { contains: searchParams.q } },
    ];
  }

  const { page, pageSize, skip, take } = parsePaging(searchParams, { pageSize: 25 });
  const [total, riders, batches] = await Promise.all([
    prisma.rider.count({ where }),
    prisma.rider.findMany({
      where,
      include: { batch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.batch.findMany({
      where: tenantWhere(centreId, orgId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const hasFilters = Boolean(searchParams.q || searchParams.status);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Riders</h1>
          <p className="text-sm text-muted-foreground">{total} total</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCsvButton entity="riders" />
          {["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role) && (
            <Button asChild variant="outline">
              <Link href="/riders/import">Bulk upload riders</Link>
            </Button>
          )}
          {/* SCHOOL_ADMINISTRATOR is read-only — they see riders but
              don't onboard new ones. Other roles keep the existing
              behaviour (anyone reaching this page can onboard). */}
          {!isReadOnly(session.role) && (
            <Button asChild>
              <Link href="/onboarding">
                <Plus className="h-4 w-4" /> Onboard new rider
              </Link>
            </Button>
          )}
        </div>
      </div>

      {total === 0 && !hasFilters ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="No riders yet"
          body={
            isReadOnly(session.role)
              ? "No riders are registered at this club yet."
              : "Onboard your first rider to start tracking attendance, exams, and fees."
          }
          // No CTA for read-only roles — they can't onboard.
          action={
            isReadOnly(session.role)
              ? undefined
              : { href: "/onboarding", label: "Onboard a Rider" }
          }
        />
      ) : (

      <Card>
        <CardHeader>
          <form className="flex gap-2">
            <input
              type="search"
              name="q"
              aria-label="Search riders by name, mobile, or email"
              defaultValue={searchParams.q ?? ""}
              placeholder="Search name, mobile, email"
              className="flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
            />
            <select
              name="status"
              aria-label="Filter riders by status"
              defaultValue={searchParams.status ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All current riders</option>
              <option value="active">Active</option>
              <option value="pending_payment">Pending Payment</option>
              <option value="suspended">Suspended</option>
              <option value="withdrawn">Withdrawn (left the club)</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <Button type="submit" size="sm" variant="outline">
              Filter
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <RidersTable
            riders={riders.map((r) => ({
              id: r.id,
              firstName: r.firstName,
              lastName: r.lastName,
              mobile: r.mobile,
              joiningDate: r.joiningDate,
              currentLevel: r.currentLevel,
              status: r.status,
              batchName: r.batch?.name ?? null,
            }))}
            batches={batches}
            canAssign={can(session.role, "rider.write") && !isReadOnly(session.role)}
          />
          <Pagination total={total} page={page} pageSize={pageSize} />
        </CardContent>
      </Card>
      )}
    </div>
  );
}
