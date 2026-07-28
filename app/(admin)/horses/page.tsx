import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { DEFAULT_WORKLOAD_CAP_MIN } from "@/lib/schemas/horse";
import { displayAgeYears } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Rabbit } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { parsePaging } from "@/lib/paging";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportCsvButton } from "@/components/ui/export-csv";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline"> = {
  active: "success",
  rest: "warning",
  retired: "outline",
};

export default async function HorsesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; ownership?: string; page?: string; pageSize?: string };
}) {
  const session = await requireSession();
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const where: any = { ...tenantWhere(centreId, orgId) };
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.ownership) where.ownership = searchParams.ownership;
  if (searchParams.q) {
    where.OR = [
      { name: { contains: searchParams.q } },
      { stableNo: { contains: searchParams.q } },
      { breed: { contains: searchParams.q } },
      { microchip: { contains: searchParams.q } },
    ];
  }

  const { page, pageSize, skip, take } = parsePaging(searchParams, { pageSize: 50 });
  const [total, horses] = await Promise.all([
    prisma.horse.count({ where }),
    prisma.horse.findMany({ where, orderBy: { name: "asc" }, skip, take }),
  ]);

  // Today's workload per horse (in minutes used vs cap).
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const todays = await prisma.horseAllocation.findMany({
    where: { horse: tenantWhere(centreId, orgId), startAt: { gte: dayStart, lte: dayEnd } },
    select: { horseId: true, startAt: true, endAt: true },
  });
  const usedByHorse = new Map<string, number>();
  for (const a of todays) {
    const m = (a.endAt.getTime() - a.startAt.getTime()) / 60000;
    usedByHorse.set(a.horseId, (usedByHorse.get(a.horseId) ?? 0) + m);
  }

  const canManage = ["SUPER_ADMIN", "CENTRE_MANAGER", "VET"].includes(session.role);
  const hasFilters = Boolean(searchParams.status || searchParams.ownership || searchParams.q);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Horses</h1>
          <p className="text-sm text-muted-foreground">
            {total} on roster · daily work cap {DEFAULT_WORKLOAD_CAP_MIN / 60} h
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCsvButton entity="horses" />
          {canManage && (
            <Button asChild>
              <Link href="/horses/new">
                <Plus className="h-4 w-4" /> Add horse
              </Link>
            </Button>
          )}
        </div>
      </div>

      {total === 0 && !hasFilters ? (
        <EmptyState
          icon={<Rabbit className="h-8 w-8" />}
          title="No horses on the roster"
          body="Add a horse to start logging workload, vaccinations, farrier visits, and allocations."
          action={canManage ? { href: "/horses/new", label: "Add the First Horse" } : undefined}
        />
      ) : (

      <Card>
        <CardHeader>
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Search</label>
              <input
                type="search"
                name="q"
                aria-label="Search horses by name, stable no, breed, or microchip"
                defaultValue={searchParams.q ?? ""}
                placeholder="Name, stable no, breed…"
                className="h-9 w-48 rounded-md border border-input bg-background px-3 text-base md:text-sm"
              />
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
                <option value="rest">On Rest</option>
                <option value="retired">Retired</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Ownership</label>
              <select aria-label="Filter by ownership"
                name="ownership"
                defaultValue={searchParams.ownership ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="club">Club</option>
                <option value="private">Private</option>
              </select>
            </div>
            <Button type="submit" size="sm" variant="outline">
              Filter
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={horses}
            getRowKey={(h) => h.id}
            emptyMessage="No horses match these filters."
            columns={[
              {
                key: "name",
                header: "Name",
                primary: true,
                cell: (h) => (
                  <Link href={`/horses/${h.id}`} className="font-medium hover:underline">
                    {h.name}
                  </Link>
                ),
              },
              { key: "breed", header: "Breed", cell: (h) => h.breed ?? "—" },
              { key: "sex", header: "Sex", cell: (h) => h.sex ?? "—" },
              { key: "age", header: "Age", cell: (h) => displayAgeYears(h.dob, h.ageYears) ?? "—" },
              { key: "stable", header: "Stable", cell: (h) => h.stableNo ?? "—" },
              { key: "status", header: "Status", cell: (h) => <Badge variant={STATUS_VARIANT[h.status] ?? "outline"}>{formatEnum(h.status)}</Badge> },
              {
                key: "workload",
                header: "Workload Today",
                cell: (h) => {
                  const used = usedByHorse.get(h.id) ?? 0;
                  const pct = Math.min(100, Math.round((used / DEFAULT_WORKLOAD_CAP_MIN) * 100));
                  const barCls = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
                  return (
                    <div className="flex items-center justify-end gap-2 md:justify-start">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full ${barCls}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(used)} / {DEFAULT_WORKLOAD_CAP_MIN} min
                      </span>
                    </div>
                  );
                },
              },
              {
                key: "open",
                header: "",
                hideOnMobile: true,
                cell: (h) => (
                  <Link href={`/horses/${h.id}`} className="text-xs text-primary underline">
                    Open →
                  </Link>
                ),
              },
            ]}
          />
          <Pagination total={total} page={page} pageSize={pageSize} />
        </CardContent>
      </Card>
      )}
    </div>
  );
}
