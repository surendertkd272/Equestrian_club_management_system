import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConsumablesClient } from "./consumables-client";

export const dynamic = "force-dynamic";

export default async function ConsumablesPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const where: any = {};
  if (centreId) where.centreId = centreId;

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
        <p className="text-sm text-muted-foreground">
          Non-drug supplies — gauze, vet wrap, gloves, scissors. Separate from the medicine
          cabinet so you can re-order quickly without sifting through scheduled drugs.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Line items" value={rows.length} />
        <Kpi label="Total units" value={totalUnits} />
        <Kpi label="Low stock" value={low.length} tone={low.length > 0 ? "amber" : undefined} />
        <Kpi label="Out of stock" value={rows.filter((r) => r.qty === 0).length} tone={rows.filter((r) => r.qty === 0).length > 0 ? "rose" : undefined} />
      </div>

      <ConsumablesClient />

      <Card>
        <CardHeader>
          <CardTitle>Cabinet</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No consumables yet — add line items above.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Item</th>
                  <th className="px-2 py-2">Category</th>
                  <th className="px-2 py-2 text-right">Stock</th>
                  <th className="px-2 py-2 text-right">Reorder at</th>
                  <th className="px-2 py-2">Storage</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const lowFlag = r.qty <= r.reorderThreshold;
                  const out = r.qty === 0;
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-2 py-2">
                        <div className="font-medium">{r.name}</div>
                        {r.supplier && <div className="text-[10px] text-muted-foreground">{r.supplier}</div>}
                      </td>
                      <td className="px-2 py-2 text-xs capitalize">{r.category}</td>
                      <td className={`px-2 py-2 text-right ${out ? "font-bold text-rose-600" : lowFlag ? "font-semibold text-amber-700" : ""}`}>
                        {r.qty} <span className="text-[10px] uppercase text-muted-foreground">{r.unit}</span>
                        {out && <Badge variant="destructive" className="ml-2 text-[10px]">OUT</Badge>}
                        {!out && lowFlag && <Badge variant="warning" className="ml-2 text-[10px]">LOW</Badge>}
                      </td>
                      <td className="px-2 py-2 text-right text-xs text-muted-foreground">{r.reorderThreshold}</td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">{r.storageLocation ?? "—"}</td>
                      <td className="px-2 py-2 text-right">
                        <MoveButtons id={r.id} unit={r.unit} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

import { MoveButtons } from "./consumables-client";
