import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { expiryStatus, daysUntil } from "@/lib/schemas/medicine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, AlertTriangle, Snowflake } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { PrescribeForm } from "./prescribe";
import { EditMedicineForm } from "./edit-medicine";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

export default async function MedicineDetail({ params }: { params: { id: string } }) {
  const session = await requireSession();
  const centreId = scopeCentre(session);

  const med = await prisma.medicine.findUnique({ where: { id: params.id } });
  if (!med) notFound();
  if (centreId && med.centreId !== centreId) notFound();
  // HQ users (centreId=null) bypass the centre check above — bound them by org
  // so they can't open another organisation's medicine by id.
  const [medOrgId, sessionOrgId] = await Promise.all([
    getOrgIdForCentre(med.centreId),
    getOrgIdForSession(session),
  ]);
  if (!sessionOrgId || medOrgId !== sessionOrgId) notFound();

  const [usages, horses] = await Promise.all([
    prisma.medicineUsage.findMany({
      where: { medicineId: med.id },
      include: { horse: { select: { id: true, name: true } } },
      orderBy: { usedAt: "desc" },
      take: 50,
    }),
    prisma.horse.findMany({
      where: { centreId: med.centreId, status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Pull vet names for usages in one go.
  const vetIds = Array.from(new Set(usages.map((u) => u.vetUserId)));
  const vets = await prisma.user.findMany({
    where: { id: { in: vetIds } },
    select: { id: true, name: true },
  });
  const vetMap = new Map(vets.map((v) => [v.id, v.name]));

  const exp = expiryStatus(med.expDate);
  const days = daysUntil(med.expDate);
  const isExpired = exp === "expired";
  const isOutOfStock = med.qty <= 0;
  const isLow = med.qty <= med.reorderThreshold;
  const canPrescribe = can(session.role, "medicine.prescribe");
  const canManage = can(session.role, "medicine.manage");
  const toDateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/medicines">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <div className="flex flex-wrap gap-1">
          {isExpired && <Badge variant="destructive">EXPIRED</Badge>}
          {!isExpired && exp === "critical" && <Badge variant="destructive">&lt; 30d</Badge>}
          {!isExpired && exp === "expiring" && <Badge variant="warning">&lt; 90d</Badge>}
          {isLow && <Badge variant="destructive">low stock</Badge>}
          {med.coldChain && (
            <Badge variant="outline" className="gap-1">
              <Snowflake className="h-3 w-3" /> cold
            </Badge>
          )}
          {med.schedule && <Badge variant="outline">{med.schedule.replace("_", " ")}</Badge>}
        </div>
      </div>

      {canManage && (
        <EditMedicineForm
          med={{
            id: med.id,
            name: med.name,
            generic: med.generic,
            category: med.category,
            schedule: med.schedule,
            batchNo: med.batchNo,
            mfgDate: toDateInput(med.mfgDate),
            expDate: toDateInput(med.expDate),
            qty: med.qty,
            reorderThreshold: med.reorderThreshold,
            supplier: med.supplier,
            storageLocation: med.storageLocation,
            coldChain: med.coldChain,
          }}
        />
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{med.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Generic</dt>
              <dd className="col-span-2">{med.generic ?? "—"}</dd>
              <dt className="text-muted-foreground">Category</dt>
              <dd className="col-span-2 capitalize">{formatEnum(med.category)}</dd>
              <dt className="text-muted-foreground">Batch #</dt>
              <dd className="col-span-2 font-mono text-xs">{med.batchNo}</dd>
              <dt className="text-muted-foreground">Mfg / Exp</dt>
              <dd className="col-span-2">
                {med.mfgDate ? formatDate(med.mfgDate) : "—"} → {formatDate(med.expDate)}
                {!isExpired && <span className="ml-2 text-xs text-muted-foreground">({days}d)</span>}
              </dd>
              <dt className="text-muted-foreground">Supplier</dt>
              <dd className="col-span-2">{med.supplier ?? "—"}</dd>
              <dt className="text-muted-foreground">Storage</dt>
              <dd className="col-span-2">{med.storageLocation ?? "—"}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stock</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className={`text-4xl font-bold ${isLow ? "text-destructive" : ""}`}>{med.qty}</div>
            <div className="text-xs text-muted-foreground">
              Reorder threshold {med.reorderThreshold}
            </div>
            {isLow && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                {isOutOfStock ? "Out of stock." : "Low stock — reorder."}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {canPrescribe && !isExpired && !isOutOfStock && horses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Prescribe to a Horse</CardTitle>
          </CardHeader>
          <CardContent>
            <PrescribeForm medicineId={med.id} horses={horses} maxQty={med.qty} />
          </CardContent>
        </Card>
      )}

      {canPrescribe && isExpired && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive">
            <AlertTriangle className="inline h-4 w-4" /> This batch is expired and cannot be prescribed.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Usage History ({usages.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {usages.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No prescriptions logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2">When</th>
                    <th className="pb-2">Horse</th>
                    <th className="pb-2">Dose</th>
                    <th className="pb-2">Route</th>
                    <th className="pb-2">Withdrawal Until</th>
                    <th className="pb-2">By</th>
                  </tr>
                </thead>
                <tbody>
                  {usages.map((u) => (
                    <tr key={u.id} className="border-t">
                      <td className="py-2 whitespace-nowrap">{formatDate(u.usedAt)}</td>
                      <td className="py-2">
                        <Link href={`/horses/${u.horse.id}`} className="text-primary underline">
                          {u.horse.name}
                        </Link>
                      </td>
                      <td className="py-2">{u.dose}</td>
                      <td className="py-2 uppercase">{u.route}</td>
                      <td className="py-2">
                        {u.withdrawalUntil ? formatDate(u.withdrawalUntil) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2">{vetMap.get(u.vetUserId) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
