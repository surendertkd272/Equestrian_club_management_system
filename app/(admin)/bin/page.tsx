import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageCatalog } from "@/lib/schemas/catalog";
import { BIN_RETENTION_DAYS, BIN_LABEL } from "@/lib/bin";
import { BinList, type BinRow } from "./bin-list";

export const dynamic = "force-dynamic";

// Recycle bin — soft-deleted catalog rows, recoverable until the 30-day
// auto-purge (daily sweep). Restore or permanently delete from here.
export default async function BinPage() {
  const session = (await getSession())!;
  if (!canManageCatalog(session.role)) redirect("/dashboard");

  const centreId = scopeCentre(session);
  const where = { ...centreWhere(centreId), active: false } as any;
  const sel = { id: true, name: true, deletedAt: true } as const;

  const [vendors, medicines, consumables, teams] = await Promise.all([
    prisma.vendor.findMany({ where, select: sel, orderBy: { deletedAt: "desc" } }),
    prisma.medicine.findMany({ where, select: sel, orderBy: { deletedAt: "desc" } }),
    prisma.consumable.findMany({ where, select: sel, orderBy: { deletedAt: "desc" } }),
    prisma.team.findMany({ where, select: sel, orderBy: { deletedAt: "desc" } }),
  ]);

  const rows: BinRow[] = [
    ...vendors.map((r) => ({ entity: "vendor" as const, ...norm(r) })),
    ...medicines.map((r) => ({ entity: "medicine" as const, ...norm(r) })),
    ...consumables.map((r) => ({ entity: "consumable" as const, ...norm(r) })),
    ...teams.map((r) => ({ entity: "team" as const, ...norm(r) })),
  ].sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Recycle Bin</h1>
        <p className="text-sm text-muted-foreground">
          Deleted items are kept here for <strong>{BIN_RETENTION_DAYS} days</strong>, then permanently
          removed automatically. Restore anything you still need, or delete it now.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deleted Items</CardTitle>
          <CardDescription>
            {rows.length === 0 ? "The bin is empty." : `${rows.length} item${rows.length === 1 ? "" : "s"} across ${new Set(rows.map((r) => r.entity)).size} type(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Nothing deleted. 🗑️</div>
          ) : (
            <BinList rows={rows} retentionDays={BIN_RETENTION_DAYS} labels={BIN_LABEL} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function norm(r: { id: string; name: string; deletedAt: Date | null }) {
  return { id: r.id, name: r.name, deletedAt: r.deletedAt?.toISOString() ?? null };
}
