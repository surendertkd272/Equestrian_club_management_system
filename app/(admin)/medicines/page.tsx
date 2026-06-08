import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { expiryStatus, daysUntil } from "@/lib/schemas/medicine";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Snowflake } from "lucide-react";
import { DeactivateButton } from "@/components/ui/deactivate-button";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const EXPIRY_BADGE: Record<string, { variant: "success" | "warning" | "destructive" | "outline"; label: string }> = {
  ok: { variant: "success", label: "ok" },
  expiring: { variant: "warning", label: "< 90d" },
  critical: { variant: "destructive", label: "< 30d" },
  expired: { variant: "destructive", label: "EXPIRED" },
};

export default async function MedicinesPage({
  searchParams,
}: {
  searchParams: { category?: string; status?: string };
}) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const where: any = { ...centreWhere(centreId), active: true };
  if (searchParams.category) where.category = searchParams.category;
  if (searchParams.status === "low") where.qty = { lte: 5 };
  if (searchParams.status === "expiring") where.expDate = { lte: new Date(Date.now() + 30 * 86400000) };

  const meds = await prisma.medicine.findMany({
    where,
    orderBy: [{ expDate: "asc" }, { name: "asc" }],
  });

  const stats = {
    total: meds.length,
    expired: meds.filter((m) => daysUntil(m.expDate) < 0).length,
    critical: meds.filter((m) => {
      const d = daysUntil(m.expDate);
      return d >= 0 && d < 30;
    }).length,
    lowStock: meds.filter((m) => m.qty <= m.reorderThreshold).length,
  };

  const canManage = can(session.role, "medicine.manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Vet Medicines</h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} batches · {stats.expired} expired · {stats.critical} expiring &lt;30d · {stats.lowStock} low-stock
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/medicines/new">
              <Plus className="h-4 w-4" /> Add medicine batch
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Category</label>
              <select aria-label="Filter by category"
                name="category"
                defaultValue={searchParams.category ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="nsaid">NSAID</option>
                <option value="antibiotic">Antibiotic</option>
                <option value="antihistamine">Antihistamine</option>
                <option value="sedative">Sedative</option>
                <option value="wound">Wound care</option>
                <option value="eye">Eye</option>
                <option value="gastric">Gastric</option>
                <option value="electrolyte">Electrolyte</option>
                <option value="supplement">Supplement</option>
                <option value="vaccine">Vaccine</option>
                <option value="antitoxin">Antitoxin</option>
                <option value="dewormer">Dewormer</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Filter</label>
              <select aria-label="Filter by status"
                name="status"
                defaultValue={searchParams.status ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="low">Low stock</option>
                <option value="expiring">Expiring &lt; 30d</option>
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
                  <th className="pb-2">Medicine</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Batch</th>
                  <th className="pb-2">Expiry</th>
                  <th className="pb-2">Stock</th>
                  <th className="pb-2">Flags</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {meds.map((m) => {
                  const exp = expiryStatus(m.expDate);
                  const days = daysUntil(m.expDate);
                  const meta = EXPIRY_BADGE[exp];
                  const isLow = m.qty <= m.reorderThreshold;
                  return (
                    <tr key={m.id} className="border-t hover:bg-muted/40">
                      <td className="py-2">
                        <Link href={`/medicines/${m.id}`} className="font-medium hover:underline">
                          {m.name}
                        </Link>
                        {m.generic && (
                          <span className="ml-2 text-xs text-muted-foreground">({m.generic})</span>
                        )}
                      </td>
                      <td className="py-2 capitalize">{m.category}</td>
                      <td className="py-2 font-mono text-xs">{m.batchNo}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <span>{formatDate(m.expDate)}</span>
                          <Badge variant={meta.variant}>
                            {meta.label}
                            {exp !== "expired" && ` · ${days}d`}
                          </Badge>
                        </div>
                      </td>
                      <td className="py-2">
                        <span className={isLow ? "font-bold text-destructive" : ""}>{m.qty}</span>
                        <span className="text-xs text-muted-foreground"> / reorder at {m.reorderThreshold}</span>
                      </td>
                      <td className="py-2">
                        <div className="flex gap-1">
                          {isLow && <Badge variant="destructive">low</Badge>}
                          {m.coldChain && (
                            <Badge variant="outline" className="gap-1">
                              <Snowflake className="h-3 w-3" /> cold
                            </Badge>
                          )}
                          {m.schedule && <Badge variant="outline">{m.schedule.replace("_", " ")}</Badge>}
                        </div>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <Link href={`/medicines/${m.id}`} className="text-xs text-primary underline">
                          Open →
                        </Link>
                        {canManage && (
                          <DeactivateButton apiPath={`/api/medicines/${m.id}`} itemName={m.name} label="Remove" />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {meds.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No medicines.
                      {canManage && (
                        <>
                          {" "}
                          <Link href="/medicines/new" className="text-primary underline">
                            Add the first batch
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
