import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EQUIPMENT_CATEGORY_ORDER } from "@/lib/schemas/equipment";

export const dynamic = "force-dynamic";

// HQ matrix: every catalog item × every centre. Cells show qty / threshold
// with a colour indicator (red = below threshold, amber = close, green =
// ok). Totals row at the bottom.
export default async function HqEquipmentMatrix() {
  const session = (await getSession())!;
  if (session.role !== "SUPER_ADMIN") redirect("/equipment");

  const [catalog, centres, stocks] = await Promise.all([
    prisma.equipmentCatalog.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.centre.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } }),
    prisma.equipmentStock.findMany(),
  ]);

  // Map [catalogId][centreId] = { qty, threshold }
  const grid = new Map<string, Map<string, { qty: number; threshold: number }>>();
  for (const s of stocks) {
    if (!grid.has(s.catalogId)) grid.set(s.catalogId, new Map());
    grid.get(s.catalogId)!.set(s.centreId, { qty: s.qty, threshold: s.threshold ?? 0 });
  }

  // Render categories in canonical order (tack → grooming → stable → rider → …),
  // not the alphabetical order the DB query returns. Stable sort preserves the
  // name ordering within each category.
  const sortedCatalog = [...catalog].sort(
    (a, b) => (EQUIPMENT_CATEGORY_ORDER[a.category] ?? 99) - (EQUIPMENT_CATEGORY_ORDER[b.category] ?? 99),
  );
  const byCategory = new Map<string, typeof catalog>();
  for (const c of sortedCatalog) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Equipment — HQ Rollup</h1>
          <p className="text-sm text-muted-foreground">
            Inventory across all {centres.length} centres. Red = below reorder point.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/equipment/catalog">Manage catalog</Link>
          </Button>
        </div>
      </div>

      {catalog.length === 0 || centres.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {catalog.length === 0 ? "No catalog items yet." : "No centres yet."}
          </CardContent>
        </Card>
      ) : (
        Array.from(byCategory.entries()).map(([category, rows]) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="text-base uppercase tracking-wide">{category}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 sticky left-0 bg-muted/40">Item</th>
                      <th className="px-2 py-2 w-20">Reorder</th>
                      {centres.map((c) => (
                        <th key={c.id} className="px-2 py-2 text-center">
                          <Link href={`/equipment?centreId=${c.id}`} className="hover:underline">
                            {c.name}
                          </Link>
                        </th>
                      ))}
                      <th className="px-2 py-2 w-16 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => {
                      let total = 0;
                      return (
                        <tr key={item.id} className="border-t">
                          <td className="px-2 py-1.5 sticky left-0 bg-card">
                            <div className="font-medium text-sm">{item.name}</div>
                            <div className="text-[10px] text-muted-foreground">{item.unit}</div>
                          </td>
                          <td className="px-2 py-1.5 font-mono">{item.defaultThreshold}</td>
                          {centres.map((c) => {
                            const cell = grid.get(item.id)?.get(c.id);
                            const qty = cell?.qty ?? 0;
                            const threshold = cell?.threshold || item.defaultThreshold;
                            total += qty;
                            const low = qty < threshold;
                            const watch = !low && qty < threshold * 1.5;
                            return (
                              <td
                                key={c.id}
                                className={`px-2 py-1.5 text-center font-mono ${
                                  low ? "bg-rose-100 text-rose-900" : watch ? "bg-amber-50" : ""
                                }`}
                                title={`${qty} ${item.unit}${qty === 1 ? "" : "s"} · reorder at ${threshold}`}
                              >
                                {qty}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-right font-mono font-semibold">{total}</td>
                        </tr>
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
