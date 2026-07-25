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
    prisma.equipmentStock.groupBy({ by: ["catalogId"], _count: { _all: true } }),
  ]);
  const adopted = new Map(adoption.map((r) => [r.catalogId, r._count._all]));

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
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
