import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { CatalogManager } from "./catalog-manager";

export const dynamic = "force-dynamic";

export default async function EquipmentCatalogPage() {
  const session = await requireSession();
  // Sprint 3.5: ADMIN joins SUPER_ADMIN on the catalog-edit privilege.
  // Centre tier still can't add/edit/delete — they only see their stock.
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/equipment");

  const [items, adoption] = await Promise.all([
    prisma.equipmentCatalog.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    // Adoption answered "how many centres stock this", which is not the
    // question anyone actually has in front of a catalog row. "3 centres" tells
    // you nothing about whether you own three tendon boots or three hundred,
    // so sum the quantities too.
    prisma.equipmentStock.groupBy({
      by: ["catalogId"],
      _count: { _all: true },
      _sum: {
        qtyUnused: true,
        qtyInUse: true,
        qtyForRepair: true,
        qtyDamaged: true,
        newRequired: true,
      },
    }),
  ]);
  const adopted = new Map(adoption.map((r) => [r.catalogId, r._count._all]));
  const totals = new Map(
    adoption.map((r) => [
      r.catalogId,
      {
        // Usable = what a coach could actually pick up today. Damaged and
        // for-repair are deliberately excluded from this figure and shown
        // separately — counting them as stock is how a centre "has" twelve
        // helmets and finds four of them cracked.
        usable: (r._sum.qtyUnused ?? 0) + (r._sum.qtyInUse ?? 0),
        unused: r._sum.qtyUnused ?? 0,
        inUse: r._sum.qtyInUse ?? 0,
        forRepair: r._sum.qtyForRepair ?? 0,
        damaged: r._sum.qtyDamaged ?? 0,
        newRequired: r._sum.newRequired ?? 0,
      },
    ]),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/equipment">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Equipment Catalog</CardTitle>
          <CardDescription>
            HQ-curated master list. Every centre&apos;s inventory page lists these items.
            Set a sensible default reorder threshold; centres can override per centre.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CatalogManager
            initial={items.map((i) => ({
              id: i.id,
              category: i.category,
              code: i.code,
              name: i.name,
              unit: i.unit,
              defaultThreshold: i.defaultThreshold,
              notes: i.notes,
              photoUrl: i.photoUrl,
              active: i.active,
              adoptedBy: adopted.get(i.id) ?? 0,
              stock: totals.get(i.id) ?? {
                usable: 0, unused: 0, inUse: 0, forRepair: 0, damaged: 0, newRequired: 0,
              },
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
