import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { Boxes } from "lucide-react";
import { ConsumablesClient } from "./consumables-client";

export const dynamic = "force-dynamic";

export default async function ConsumablesPage() {
  const session = await requireSession();
  const centreId = scopeCentre(session);

  // Consumable has a scalar `centreId` but NO `centre` relation, so the
  // tenantWhere() relation-filter can't be used. Bound by org instead: resolve
  // the org's centres and constrain to them, so an HQ user's "all centres"
  // (centreId=null) can't fall through to an empty filter that leaks every
  // org's consumables. Fail closed if the org can't be resolved.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const orgCentreIds = (
    await prisma.centre.findMany({ where: { orgId }, select: { id: true } })
  ).map((c) => c.id);

  const where: any = {
    active: true,
    centreId: centreId ?? { in: orgCentreIds },
  };

  const rows = await prisma.consumable.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const low = rows.filter((r) => r.qty <= r.reorderThreshold);
  const totalUnits = rows.reduce((s, r) => s + r.qty, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">First-Aid Consumables</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Line Items" value={rows.length} />
        <Kpi label="Total Units" value={totalUnits} />
        <Kpi label="Low Stock" value={low.length} tone={low.length > 0 ? "amber" : undefined} />
        <Kpi label="Out of Stock" value={rows.filter((r) => r.qty === 0).length} tone={rows.filter((r) => r.qty === 0).length > 0 ? "rose" : undefined} />
      </div>

      <ConsumablesClient />

      <Card>
        <CardHeader>
          <CardTitle>Cabinet</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Boxes className="h-8 w-8" />}
              title="No consumables tracked yet"
              body="Bandages, dressings, hygiene supplies, disposable tools — track stock here so the medicine cabinet auto-warns when you're running low. Use the form above to add the first item."
            />
          ) : (
            <ResponsiveTable
              rows={rows}
              getRowKey={(r) => r.id}
              columns={[
                {
                  key: "item",
                  header: "Item",
                  primary: true,
                  cell: (r) => (
                    <>
                      <div className="font-medium">{r.name}</div>
                      {r.supplier && <div className="text-[10px] text-muted-foreground">{r.supplier}</div>}
                    </>
                  ),
                },
                {
                  key: "category",
                  header: "Category",
                  className: "text-xs capitalize",
                  cell: (r) => r.category,
                },
                {
                  key: "stock",
                  header: "Stock",
                  headerClassName: "text-right",
                  cell: (r) => {
                    const lowFlag = r.qty <= r.reorderThreshold;
                    const out = r.qty === 0;
                    return (
                      <div className={`text-right ${out ? "font-bold text-rose-600" : lowFlag ? "font-semibold text-amber-700" : ""}`}>
                        {r.qty} <span className="text-[10px] uppercase text-muted-foreground">{r.unit}</span>
                        {out && <Badge variant="destructive" className="ml-2 text-[10px]">OUT</Badge>}
                        {!out && lowFlag && <Badge variant="warning" className="ml-2 text-[10px]">LOW</Badge>}
                      </div>
                    );
                  },
                },
                {
                  key: "reorder",
                  header: "Reorder At",
                  headerClassName: "text-right",
                  className: "text-right text-xs text-muted-foreground",
                  cell: (r) => r.reorderThreshold,
                },
                {
                  key: "storage",
                  header: "Storage",
                  className: "text-xs text-muted-foreground",
                  cell: (r) => r.storageLocation ?? "—",
                },
                {
                  key: "actions",
                  header: "",
                  cell: (r) => (
                    <div className="flex items-center justify-end gap-1">
                      <MoveButtons id={r.id} unit={r.unit} />
                      <EditConsumable
                        row={{
                          id: r.id,
                          name: r.name,
                          category: r.category,
                          unit: r.unit,
                          qty: r.qty,
                          reorderThreshold: r.reorderThreshold,
                          supplier: r.supplier,
                          storageLocation: r.storageLocation,
                        }}
                      />
                    </div>
                  ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "amber" | "rose" }) {
  const cls = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-700" : "";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

import { MoveButtons, EditConsumable } from "./consumables-client";
