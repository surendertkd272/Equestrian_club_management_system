import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InventoryRow } from "./inventory-row";

export const dynamic = "force-dynamic";

// Centre-scoped inventory of every equipment catalog item. SUPER_ADMIN
// can override the centre via ?centreId= — same page renders the matrix
// for any club from HQ.
export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: { centreId?: string };
}) {
  const session = (await getSession())!;
  // HQ-tier admins (SUPER_ADMIN + ADMIN) without a centre context (via
  // ?centreId or topbar HQ filter) land on the HQ matrix instead.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (isHQ && !searchParams.centreId && !session.centreId) {
    const filtered = scopeCentre(session);
    if (!filtered) redirect("/equipment/hq");
  }
  const centreId =
    isHQ && searchParams.centreId ? searchParams.centreId : scopeCentre(session);
  if (!centreId) redirect("/dashboard");

  const [centre, catalog, stocks] = await Promise.all([
    prisma.centre.findUnique({ where: { id: centreId }, select: { id: true, name: true, slug: true } }),
    prisma.equipmentCatalog.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    prisma.equipmentStock.findMany({ where: { centreId } }),
  ]);
  const stockByCatalog = new Map(stocks.map((s) => [s.catalogId, s]));

  const canEdit = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "INVENTORY_MANAGER", "STABLE_MANAGER", "HEAD_COACH"].includes(
    session.role,
  );
  const canManageCatalog = session.role === "SUPER_ADMIN" || session.role === "ADMIN";

  // Group by category for the on-screen layout (same shape as the level
  // catalog above: discipline header → rows).
  const byCategory = new Map<string, typeof catalog>();
  for (const c of catalog) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c);
  }

  // Available = unused + in-use (for-repair + damaged don't count). Below
  // threshold → "low".
  const lowCount = catalog.filter((c) => {
    const s = stockByCatalog.get(c.id);
    const t = s?.threshold ?? c.defaultThreshold;
    const available = (s?.qtyUnused ?? 0) + (s?.qtyInUse ?? 0);
    return available < t;
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tack &amp; Equipment</h1>
          <p className="text-sm text-muted-foreground">
            {centre?.name ?? "Centre"} inventory. {lowCount > 0 && (
              <span className="text-rose-600">
                {lowCount} item{lowCount === 1 ? "" : "s"} below reorder point.
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {isHQ && (
            <>
              <Button asChild variant="outline">
                <Link href="/equipment/hq">HQ matrix</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/equipment/catalog">Catalog</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/api/equipment/stock/export?centreId=${centreId}`}>Export CSV</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {catalog.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No equipment catalog yet.
            {canManageCatalog && (
              <>
                {" "}
                <Link href="/equipment/catalog" className="text-primary underline">
                  Set up the catalog →
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        Array.from(byCategory.entries()).map(([category, rows]) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="text-base uppercase tracking-wide">{category}</CardTitle>
              <CardDescription>{rows.length} item{rows.length === 1 ? "" : "s"}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="pb-2">Item</th>
                      <th className="pb-2 w-16 text-center">Unused</th>
                      <th className="pb-2 w-16 text-center">In Use</th>
                      <th className="pb-2 w-16 text-center">For Repair</th>
                      <th className="pb-2 w-16 text-center">Damaged</th>
                      <th className="pb-2 w-12 text-center">Total</th>
                      <th className="pb-2 w-16 text-center">New Req</th>
                      <th className="pb-2 w-24">Owner</th>
                      <th className="pb-2 w-32">Comments</th>
                      <th className="pb-2 w-16">Reorder at</th>
                      <th className="pb-2 w-16">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => {
                      const s = stockByCatalog.get(c.id);
                      const threshold = s?.threshold ?? c.defaultThreshold;
                      return (
                        <InventoryRow
                          key={c.id}
                          centreId={centreId}
                          catalogId={c.id}
                          name={c.name}
                          code={c.code}
                          unit={c.unit}
                          qtyUnused={s?.qtyUnused ?? 0}
                          qtyInUse={s?.qtyInUse ?? 0}
                          qtyForRepair={s?.qtyForRepair ?? 0}
                          qtyDamaged={s?.qtyDamaged ?? 0}
                          newRequired={s?.newRequired ?? 0}
                          owner={s?.owner ?? null}
                          notes={s?.notes ?? null}
                          threshold={threshold}
                          defaultThreshold={c.defaultThreshold}
                          canEdit={canEdit}
                          canSetThreshold={canManageCatalog || ["CENTRE_MANAGER", "INVENTORY_MANAGER"].includes(session.role)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
