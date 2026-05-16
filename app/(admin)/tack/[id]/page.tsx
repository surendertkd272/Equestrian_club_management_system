import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { qrSvg } from "@/lib/cert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Wrench } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { IssueReturn } from "./issue-return";
import { Maintenance } from "./maintenance";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  new: "success",
  in_use: "outline",
  repair: "destructive",
  retired: "outline",
};

export default async function AssetDetail({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const asset = await prisma.asset.findUnique({
    where: { id: params.id },
    include: {
      issuances: { orderBy: { issuedAt: "desc" } },
      maintenance: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!asset) notFound();
  if (centreId && asset.centreId !== centreId) notFound();

  const canManage = can(session.role, "asset.manage");
  const liveIssuance = asset.issuances.find((i) => !i.returnedAt);

  // Resolve recipient labels for the issuance log.
  const userIds = Array.from(new Set(asset.issuances.map((i) => i.issuedToUserId).filter(Boolean) as string[]));
  const riderIds = Array.from(new Set(asset.issuances.map((i) => i.issuedToRiderId).filter(Boolean) as string[]));
  const horseIds = Array.from(new Set(asset.issuances.map((i) => i.issuedToHorseId).filter(Boolean) as string[]));
  const issuerIds = Array.from(new Set(asset.issuances.map((i) => i.issuedBy)));

  const [users, riders, horses, issuers, availableRiders, availableHorses, availableUsers] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.rider.findMany({ where: { id: { in: riderIds } }, select: { id: true, firstName: true, lastName: true } }),
    prisma.horse.findMany({ where: { id: { in: horseIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: issuerIds } }, select: { id: true, name: true } }),
    prisma.rider.findMany({
      where: { centreId: asset.centreId, status: "active" },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.horse.findMany({
      where: { centreId: asset.centreId, status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { centreId: asset.centreId, status: "active" },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const riderMap = new Map(riders.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));
  const horseMap = new Map(horses.map((h) => [h.id, h.name]));
  const issuerMap = new Map(issuers.map((u) => [u.id, u.name]));

  type IssuanceRow = NonNullable<typeof asset>["issuances"][number];
  function recipientOf(i: IssuanceRow): string {
    if (i.issuedToUserId) return `${userMap.get(i.issuedToUserId) ?? "?"} (staff)`;
    if (i.issuedToRiderId) return `${riderMap.get(i.issuedToRiderId) ?? "?"} (rider)`;
    if (i.issuedToHorseId) return `${horseMap.get(i.issuedToHorseId) ?? "?"} (horse)`;
    return "—";
  }

  const qr = await qrSvg(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/tack/by-code/${asset.qrCode}`, { size: 180 });
  const openMaintenance = asset.maintenance.filter((m) => !m.repairedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/tack">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <Badge variant={STATUS_VARIANT[asset.status] ?? "outline"}>{asset.status.replace("_", " ")}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{asset.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Category</dt>
              <dd className="col-span-2 capitalize">
                {asset.category.replace("_", " ")}
                {asset.subcategory && ` · ${asset.subcategory.replaceAll("_", " ")}`}
              </dd>
              <dt className="text-muted-foreground">Brand</dt>
              <dd className="col-span-2">{asset.brand ?? "—"}</dd>
              <dt className="text-muted-foreground">Purchase</dt>
              <dd className="col-span-2">
                {asset.purchaseDate ? formatDate(asset.purchaseDate) : "—"}
                {asset.cost !== null ? ` · ₹${asset.cost.toLocaleString("en-IN")}` : ""}
              </dd>
              <dt className="text-muted-foreground">QR code</dt>
              <dd className="col-span-2 font-mono text-xs">{asset.qrCode}</dd>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="col-span-2">{asset.notes ?? "—"}</dd>
            </dl>
            {liveIssuance && (
              <div className="mt-4 rounded-md border bg-amber-50 p-3 text-sm">
                <div className="text-xs font-semibold uppercase text-amber-700">Currently issued</div>
                <div className="mt-1">
                  To <b>{recipientOf(liveIssuance)}</b>{" "}
                  <span className="text-muted-foreground">
                    · since{" "}
                    {liveIssuance.issuedAt.toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · by {issuerMap.get(liveIssuance.issuedBy) ?? "—"}
                  </span>
                </div>
                {liveIssuance.note && <div className="mt-1 text-xs italic text-muted-foreground">{liveIssuance.note}</div>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scan code</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-2 print:break-inside-avoid">
              <div className="h-44 w-44 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="font-mono text-xs">{asset.qrCode}</div>
              <div className="text-[10px] text-muted-foreground">
                Scan → opens <code>/tack/by-code/{asset.qrCode}</code>
              </div>
              <Button asChild variant="outline" size="sm" className="mt-1">
                <a href="javascript:window.print()">Print sticker</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {canManage && asset.status !== "retired" && (
        <IssueReturn
          assetId={asset.id}
          liveIssuance={
            liveIssuance
              ? {
                  id: liveIssuance.id,
                  recipient: recipientOf(liveIssuance),
                }
              : null
          }
          riders={availableRiders.map((r) => ({ id: r.id, label: `${r.firstName} ${r.lastName}` }))}
          horses={availableHorses.map((h) => ({ id: h.id, label: h.name }))}
          users={availableUsers.filter((u) => u.role !== "RIDER").map((u) => ({ id: u.id, label: `${u.name} · ${u.role.replaceAll("_", " ").toLowerCase()}` }))}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Issuance history ({asset.issuances.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {asset.issuances.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No issuances yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Issued</th>
                  <th className="pb-2">Recipient</th>
                  <th className="pb-2">Returned</th>
                  <th className="pb-2">Condition</th>
                  <th className="pb-2">By</th>
                </tr>
              </thead>
              <tbody>
                {asset.issuances.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="py-2 whitespace-nowrap text-xs">
                      {i.issuedAt.toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-2">{recipientOf(i)}</td>
                    <td className="py-2 whitespace-nowrap text-xs">
                      {i.returnedAt
                        ? i.returnedAt.toLocaleString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : <Badge variant="warning">open</Badge>}
                    </td>
                    <td className="py-2">
                      {i.conditionAtReturn ? (
                        <Badge variant={i.conditionAtReturn === "good" ? "success" : "destructive"}>
                          {i.conditionAtReturn}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 text-xs">{issuerMap.get(i.issuedBy) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4" /> Maintenance ({asset.maintenance.length})
            </CardTitle>
            {openMaintenance.length > 0 && (
              <Badge variant="destructive">{openMaintenance.length} open</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {asset.maintenance.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted-foreground">No repairs logged.</p>
          ) : (
            <ul className="divide-y text-sm">
              {asset.maintenance.map((m) => (
                <li key={m.id} className="flex items-start justify-between py-2">
                  <div>
                    <div className="font-medium">{m.issue}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Opened {formatDate(m.createdAt)}
                      {m.vendor && ` · ${m.vendor}`}
                      {m.cost !== null && ` · ₹${m.cost.toLocaleString("en-IN")}`}
                      {m.repairedAt && ` · repaired ${formatDate(m.repairedAt)}`}
                    </div>
                  </div>
                  {m.repairedAt ? (
                    <Badge variant="success">closed</Badge>
                  ) : (
                    canManage && <CloseMaintenance assetId={asset.id} maintenanceId={m.id} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && <Maintenance assetId={asset.id} />}
        </CardContent>
      </Card>
    </div>
  );
}

import { CloseMaintenance } from "./close-maintenance";
