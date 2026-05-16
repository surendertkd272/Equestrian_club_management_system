import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  new: "success",
  in_use: "outline",
  repair: "destructive",
  retired: "outline",
};

export default async function TackPage({
  searchParams,
}: {
  searchParams: { category?: string; status?: string };
}) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const where: any = { ...centreWhere(centreId) };
  if (searchParams.category) where.category = searchParams.category;
  if (searchParams.status) where.status = searchParams.status;

  const assets = await prisma.asset.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: {
      issuances: {
        where: { returnedAt: null },
        orderBy: { issuedAt: "desc" },
        take: 1,
      },
    },
  });

  // Resolve "issued to" labels for the currently-open issuances.
  const userIds = new Set<string>();
  const riderIds = new Set<string>();
  const horseIds = new Set<string>();
  for (const a of assets) {
    const live = a.issuances[0];
    if (live?.issuedToUserId) userIds.add(live.issuedToUserId);
    if (live?.issuedToRiderId) riderIds.add(live.issuedToRiderId);
    if (live?.issuedToHorseId) horseIds.add(live.issuedToHorseId);
  }
  const [users, riders, horses] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }),
    prisma.rider.findMany({ where: { id: { in: [...riderIds] } }, select: { id: true, firstName: true, lastName: true } }),
    prisma.horse.findMany({ where: { id: { in: [...horseIds] } }, select: { id: true, name: true } }),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const riderMap = new Map(riders.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));
  const horseMap = new Map(horses.map((h) => [h.id, h.name]));

  function labelOf(live: (typeof assets)[number]["issuances"][number] | undefined): string | null {
    if (!live) return null;
    if (live.issuedToUserId) return `${userMap.get(live.issuedToUserId) ?? "?"} (staff)`;
    if (live.issuedToRiderId) return `${riderMap.get(live.issuedToRiderId) ?? "?"} (rider)`;
    if (live.issuedToHorseId) return `${horseMap.get(live.issuedToHorseId) ?? "?"} (horse)`;
    return null;
  }

  const canManage = can(session.role, "asset.manage");
  const stats = {
    total: assets.length,
    inUse: assets.filter((a) => a.status === "in_use").length,
    repair: assets.filter((a) => a.status === "repair").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tack & Equipment</h1>
          <p className="text-sm text-muted-foreground">
            §4.10 / §4.11 · {stats.total} assets · {stats.inUse} in use · {stats.repair} in repair · QR-tagged for scan-to-issue
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/tack/new">
              <Plus className="h-4 w-4" /> Add asset
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Category</label>
              <select
                name="category"
                defaultValue={searchParams.category ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="tack">Tack (saddles/bridles/helmets…)</option>
                <option value="school_equipment">School equipment</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Status</label>
              <select
                name="status"
                defaultValue={searchParams.status ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="new">New / available</option>
                <option value="in_use">In use</option>
                <option value="repair">In repair</option>
                <option value="retired">Retired</option>
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
                  <th className="pb-2">Asset</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">QR code</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Currently with</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const live = a.issuances[0];
                  return (
                    <tr key={a.id} className="border-t hover:bg-muted/40">
                      <td className="py-2">
                        <Link href={`/tack/${a.id}`} className="font-medium hover:underline">
                          {a.name}
                        </Link>
                        {a.brand && <span className="ml-2 text-xs text-muted-foreground">{a.brand}</span>}
                      </td>
                      <td className="py-2">
                        <span className="text-xs capitalize">{a.category.replace("_", " ")}</span>
                        {a.subcategory && <span className="ml-1 text-xs text-muted-foreground">· {a.subcategory.replace("_", " ")}</span>}
                      </td>
                      <td className="py-2 font-mono text-xs">{a.qrCode}</td>
                      <td className="py-2">
                        <Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{a.status.replace("_", " ")}</Badge>
                      </td>
                      <td className="py-2 text-xs">{labelOf(live) ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-2 text-right">
                        <Link href={`/tack/${a.id}`} className="text-xs text-primary underline">
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {assets.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground">
                      No assets.
                      {canManage && (
                        <>
                          {" "}
                          <Link href="/tack/new" className="text-primary underline">
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
        </CardContent>
      </Card>
    </div>
  );
}
