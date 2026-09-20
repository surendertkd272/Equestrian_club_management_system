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
  searchParams: {
    q?: string;
    status?: string;
    ownership?: string;
    missingMarks?: string;
    page?: string;
    pageSize?: string;
  };
}) {
  const session = await requireSession();
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const where: any = { ...tenantWhere(centreId, orgId) };
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.ownership) where.ownership = searchParams.ownership;
  // Identification marks became required for NEW horses, which does nothing
  // for the ones already on the roster. This is how that backlog gets found
  // and worked through — without it the requirement is true on paper and
  // blank in the stable.
  //
  // AND, not where.OR: the search below already owns OR, and assigning it
  // twice would silently drop whichever filter was set first.
  if (searchParams.missingMarks === "1") {
    where.AND = [
      ...(where.AND ?? []),
      { OR: [{ identificationMarks: null }, { identificationMarks: "" }] },
    ];
  }
  if (searchParams.q) {
    where.OR = [
      { name: { contains: searchParams.q } },
      { stableNo: { contains: searchParams.q } },
      { breed: { contains: searchParams.q } },
      { microchip: { contains: searchParams.q } },
    ];
  }

  const { page, pageSize, skip, take } = parsePaging(searchParams, { pageSize: 50 });
  const [total, horses, missingMarksCount] = await Promise.all([
    prisma.horse.count({ where }),
    prisma.horse.findMany({ where, orderBy: { name: "asc" }, skip, take }),
    // Counted across the whole roster, not the filtered page — this is a
    // backlog figure, and it should not shrink just because someone searched.
    prisma.horse.count({
      where: {
        ...tenantWhere(centreId, orgId),
        OR: [{ identificationMarks: null }, { identificationMarks: "" }],
      },
    }),
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
  const showingMissingOnly = searchParams.missingMarks === "1";
  const hasFilters = Boolean(
    searchParams.status || searchParams.ownership || searchParams.q || showingMissingOnly,
  );

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

      {missingMarksCount > 0 && !showingMissingOnly && (
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span>
              <strong>{missingMarksCount}</strong>{" "}
              {missingMarksCount === 1 ? "horse has" : "horses have"} no identification marks on
              record — they were added before the field existed.
            </span>
            <Link
              href="/horses?missingMarks=1"
              className="whitespace-nowrap text-sm text-primary underline"
            >
              Show them →
            </Link>
          </CardContent>
        </Card>
      )}

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
          {showingMissingOnly && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span>Showing only horses with no identification marks.</span>
              <Link href="/horses" className="text-sm text-primary underline">
                Show all horses
              </Link>
            </div>
          )}
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            {/* Kept across a search/status change, so narrowing the backlog
                doesn't silently drop you back into the full roster. */}
            {showingMissingOnly && <input type="hidden" name="missingMarks" value="1" />}
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
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/horses/${h.id}`} className="font-medium hover:underline">
                      {h.name}
                    </Link>
                    {/* Marked on the row as well as counted above, so the gap
                        is visible while you are looking at the horse rather
                        than only when you go looking for it. */}
                    {!h.identificationMarks && (
                      <Badge variant="warning" title="No identification marks on record">
                        No marks
                      </Badge>
                    )}
                  </span>
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
