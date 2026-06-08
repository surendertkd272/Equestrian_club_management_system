import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isReadOnly } from "@/lib/roles";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Plus, Users } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { parsePaging } from "@/lib/paging";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportCsvButton } from "@/components/ui/export-csv";

export const dynamic = "force-dynamic";

const statusVariant = (s: string) =>
  s === "active" ? "success" : s === "pending_payment" ? "warning" : s === "suspended" ? "destructive" : "outline";

export default async function RidersPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string; pageSize?: string };
}) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const where: any = { ...centreWhere(centreId) };
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.q) {
    where.OR = [
      { firstName: { contains: searchParams.q } },
      { lastName: { contains: searchParams.q } },
      { mobile: { contains: searchParams.q } },
      { email: { contains: searchParams.q } },
    ];
  }

  const { page, pageSize, skip, take } = parsePaging(searchParams, { pageSize: 25 });
  const [total, riders] = await Promise.all([
    prisma.rider.count({ where }),
    prisma.rider.findMany({
      where,
      include: { batch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
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
              <Link href="/riders/import">Import CSV</Link>
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
              : { href: "/onboarding", label: "Onboard a rider" }
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
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="pending_payment">Pending payment</option>
              <option value="suspended">Suspended</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <Button type="submit" size="sm" variant="outline">
              Filter
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Mobile</th>
                  <th className="pb-2">Joined</th>
                  <th className="pb-2">Batch</th>
                  <th className="pb-2">Level</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {riders.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/40">
                    <td className="py-2">
                      <Link href={`/riders/${r.id}`} className="font-medium hover:underline">
                        {r.firstName} {r.lastName}
                      </Link>
                    </td>
                    <td className="py-2">{r.mobile}</td>
                    <td className="py-2">{formatDate(r.joiningDate)}</td>
                    <td className="py-2">{r.batch?.name ?? "—"}</td>
                    <td className="py-2">{r.currentLevel ?? "—"}</td>
                    <td className="py-2">
                      <Badge variant={statusVariant(r.status) as any}>{r.status.replace("_", " ")}</Badge>
                    </td>
                  </tr>
                ))}
                {riders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground">
                      No riders match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={pageSize} />
        </CardContent>
      </Card>
      )}
    </div>
  );
}
