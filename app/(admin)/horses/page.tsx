import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { DEFAULT_WORKLOAD_CAP_MIN } from "@/lib/schemas/horse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Rabbit } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { parsePaging } from "@/lib/paging";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportCsvButton } from "@/components/ui/export-csv";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline"> = {
  active: "success",
  rest: "warning",
  retired: "outline",
};

export default async function HorsesPage({
  searchParams,
}: {
  searchParams: { status?: string; ownership?: string; page?: string; pageSize?: string };
}) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const where: any = { ...centreWhere(centreId) };
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.ownership) where.ownership = searchParams.ownership;

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
    where: { horse: centreId ? { centreId } : undefined, startAt: { gte: dayStart, lte: dayEnd } },
    select: { horseId: true, startAt: true, endAt: true },
  });
  const usedByHorse = new Map<string, number>();
  for (const a of todays) {
    const m = (a.endAt.getTime() - a.startAt.getTime()) / 60000;
    usedByHorse.set(a.horseId, (usedByHorse.get(a.horseId) ?? 0) + m);
  }

  const canManage = ["SUPER_ADMIN", "CENTRE_MANAGER", "VET"].includes(session.role);
  const hasFilters = Boolean(searchParams.status || searchParams.ownership);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Horses</h1>
          <p className="text-sm text-muted-foreground">
            §4.13 · {total} on roster · daily work cap {DEFAULT_WORKLOAD_CAP_MIN / 60} h
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
          action={canManage ? { href: "/horses/new", label: "Add the first horse" } : undefined}
        />
      ) : (

      <Card>
        <CardHeader>
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Status</label>
              <select
                name="status"
                defaultValue={searchParams.status ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="rest">On rest</option>
                <option value="retired">Retired</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Ownership</label>
              <select
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Breed</th>
                  <th className="pb-2">Sex</th>
                  <th className="pb-2">Age</th>
                  <th className="pb-2">Stable</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Workload today</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {horses.map((h) => {
                  const used = usedByHorse.get(h.id) ?? 0;
                  const pct = Math.min(100, Math.round((used / DEFAULT_WORKLOAD_CAP_MIN) * 100));
                  const barCls =
                    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
                  return (
                    <tr key={h.id} className="border-t hover:bg-muted/40">
                      <td className="py-2">
                        <Link href={`/horses/${h.id}`} className="font-medium hover:underline">
                          {h.name}
                        </Link>
                      </td>
                      <td className="py-2">{h.breed ?? "—"}</td>
                      <td className="py-2">{h.sex ?? "—"}</td>
                      <td className="py-2">{h.ageYears ?? "—"}</td>
                      <td className="py-2">{h.stableNo ?? "—"}</td>
                      <td className="py-2">
                        <Badge variant={STATUS_VARIANT[h.status] ?? "outline"}>{h.status}</Badge>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div className={`h-full ${barCls}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {Math.round(used)} / {DEFAULT_WORKLOAD_CAP_MIN} min
                          </span>
                        </div>
                      </td>
                      <td className="py-2 text-right">
                        <Link href={`/horses/${h.id}`} className="text-xs text-primary underline">
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {horses.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      No horses match these filters.
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
