import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InventoryRow } from "./inventory-row";
import { EQUIPMENT_CATEGORY_ORDER } from "@/lib/schemas/equipment";

export const dynamic = "force-dynamic";

// Centre-scoped inventory of every equipment catalog item. SUPER_ADMIN
// can override the centre via ?centreId= — same page renders the matrix
// for any club from HQ.
export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: { centreId?: string; q?: string; uncounted?: string };
}) {
  const session = await requireSession();
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

  // Bind to the caller's org so an HQ user can't pass a foreign org's
  // ?centreId= and read its centre/stock. tenantWhere() turns a foreign
  // centreId into a 0-row match; the centre lookup is org-bounded too.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const [centre, catalog, stocks] = await Promise.all([
    prisma.centre.findFirst({ where: { id: centreId, orgId }, select: { id: true, name: true, slug: true } }),
    // Pull all rows sorted by name; reorder by EQUIPMENT_CATEGORY_ORDER
    // below in JS so the display sequence matches the canonical group
    // order (tack → grooming → stable → rider → …) rather than alphabetical.
    // EquipmentCatalog is a platform-global catalog (no centre/org column) —
    // shared across all centres, so it stays unscoped.
    prisma.equipmentCatalog.findMany({ where: { active: true }, orderBy: [{ name: "asc" }] }),
    prisma.equipmentStock.findMany({ where: tenantWhere(centreId, orgId) }),
  ]);
  // A foreign / unknown centreId resolves to no centre under this org → fail closed.
  if (!centre) redirect("/dashboard");
  const stockByCatalog = new Map(stocks.map((s) => [s.catalogId, s]));

  // COACH included per field request: any coach can step in and manage
  // inventory in another coach's absence (shared ground-ops access).
  const canEdit = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "INVENTORY_MANAGER", "STABLE_MANAGER", "HEAD_COACH", "COACH"].includes(
    session.role,
  );
  const canManageCatalog = session.role === "SUPER_ADMIN" || session.role === "ADMIN";

  // Text search across item names (?q=) — server-side so the whole page
  // (grouping, counts) reflects the filter. Empty/absent q = full catalog.
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const searched = q
    ? catalog.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    : catalog;
  // ?uncounted=1 — work the "nobody has ever counted this here" list
  // deliberately, rather than hunting for blanks among 153 rows.
  const onlyUncounted = searchParams.uncounted === "1";
  const visibleCatalog = onlyUncounted
    ? searched.filter((c) => !stockByCatalog.has(c.id))
    : searched;

  // Group by category. Map preserves insertion order — pre-sort the
  // catalog by EQUIPMENT_CATEGORY_ORDER so the resulting iteration
  // order is the canonical display sequence (tack first, etc.).
  const sortedCatalog = [...visibleCatalog].sort((a, b) => {
    const ai = EQUIPMENT_CATEGORY_ORDER[a.category] ?? 99;
    const bi = EQUIPMENT_CATEGORY_ORDER[b.category] ?? 99;
    return ai - bi;
  });
  const byCategory = new Map<string, typeof catalog>();
  for (const c of sortedCatalog) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c);
  }

  // Available = unused + in-use (for-repair + damaged don't count). Below
  // threshold → "low".
  //
  // Counted rows ONLY. This used to include every item with no stock row,
  // which is most of the catalog at most centres — so the banner reported
  // ~91 of 153 "below reorder point" at a centre that had simply never
  // counted them, and the one number meant to drive reordering was noise.
  const lowCount = catalog.filter((c) => {
    const s = stockByCatalog.get(c.id);
    if (!s) return false;
    const t = s.threshold ?? c.defaultThreshold;
    return s.qtyUnused + s.qtyInUse < t;
  }).length;
  const uncountedCount = catalog.filter((c) => !stockByCatalog.has(c.id)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tack &amp; Equipment</h1>
          <p className="text-sm text-muted-foreground">
            {centre?.name ?? "Centre"} inventory.{" "}
            {lowCount > 0 && (
              <span className="text-rose-600">
                {lowCount} counted item{lowCount === 1 ? "" : "s"} below reorder point.
              </span>
            )}{" "}
            {uncountedCount > 0 && (
              <Link
                href={
                  searchParams.centreId
                    ? `/equipment?centreId=${searchParams.centreId}&uncounted=1`
                    : "/equipment?uncounted=1"
                }
                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                {uncountedCount} never counted here
              </Link>
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

      {/* Search — plain GET form so the server render reflects the filter.
          centreId is preserved for HQ users browsing a specific club. */}
      <form method="GET" className="flex max-w-md items-center gap-2">
        {isHQ && searchParams.centreId && <input type="hidden" name="centreId" value={searchParams.centreId} />}
        {onlyUncounted && <input type="hidden" name="uncounted" value="1" />}
        <input
          type="search"
          name="q"
          defaultValue={searchParams.q ?? ""}
          placeholder="Search items… e.g. helmet, comb, saddle"
          className="h-9 w-full rounded-md border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          aria-label="Search equipment"
        />
        <Button type="submit" variant="outline" size="sm">Search</Button>
        {(q || onlyUncounted) && (
          <Button asChild variant="ghost" size="sm">
            <Link href={searchParams.centreId ? `/equipment?centreId=${searchParams.centreId}` : "/equipment"}>Clear</Link>
          </Button>
        )}
      </form>

      {byCategory.size > 1 && (
        <nav aria-label="Jump to category" className="flex flex-wrap gap-1.5">
          {Array.from(byCategory.entries()).map(([category, rows]) => (
            <a
              key={category}
              href={`#cat-${category}`}
              className="rounded-full border bg-card px-2.5 py-1 text-[11px] uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {category} <span className="font-mono">{rows.length}</span>
            </a>
          ))}
        </nav>
      )}

      {onlyUncounted && (
        <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Showing only items <strong>never counted</strong> at {centre?.name ?? "this centre"} —
          {" "}{visibleCatalog.length} of {catalog.length}. These show{" "}
          <span className="font-mono">—</span> rather than 0, because no one has looked yet.
        </div>
      )}

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
      ) : visibleCatalog.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {onlyUncounted && !q
              ? "Every item has been counted at this centre."
              : onlyUncounted
                ? `No uncounted items match “${searchParams.q}”.`
                : `No items match “${searchParams.q}”.`}
          </CardContent>
        </Card>
      ) : (
        Array.from(byCategory.entries()).map(([category, rows]) => (
          <Card key={category} id={`cat-${category}`} className="scroll-mt-4">
            <CardHeader className="sticky top-0 z-10 rounded-t-lg border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
              <CardTitle className="text-base uppercase tracking-wide">{category}</CardTitle>
              <CardDescription>{rows.length} item{rows.length === 1 ? "" : "s"}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[10px] tracking-wide text-muted-foreground">
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
                      <th className="pb-2 w-16">Reorder At</th>
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
                          photoUrl={c.photoUrl}
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
                          hasRecord={!!s}
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
