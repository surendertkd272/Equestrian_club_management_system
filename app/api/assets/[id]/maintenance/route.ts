import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createMaintenanceSchema } from "@/lib/schemas/asset";
import { audit } from "@/lib/audit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "asset.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createMaintenanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const asset = await prisma.asset.findUnique({ where: { id: params.id } });
  if (!asset) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && asset.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const row = await prisma.assetMaintenance.create({
    data: {
      assetId: asset.id,
      issue: d.issue,
      vendor: d.vendor || null,
      cost: d.cost ?? null,
      scheduledAt: d.scheduledAt ? new Date(d.scheduledAt) : null,
      createdBy: session.userId,
    },
  });

  // Send asset to repair if not already there.
  if (asset.status !== "repair" && asset.status !== "retired") {
    await prisma.asset.update({ where: { id: asset.id }, data: { status: "repair" } });
  }

  await audit({
    userId: session.userId,
    action: "asset.maintenance_open",
    tableName: "assetMaintenance",
    rowId: row.id,
    after: { assetId: asset.id, issue: d.issue, vendor: d.vendor, cost: d.cost },
  });

  return NextResponse.json({ id: row.id });
}

// Mark a maintenance row as repaired (closes the ticket; asset returns to "new" status).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "asset.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const maintenanceId = body?.maintenanceId as string | undefined;
  if (!maintenanceId) return NextResponse.json({ error: "maintenanceId required" }, { status: 400 });

  const row = await prisma.assetMaintenance.findUnique({ where: { id: maintenanceId }, include: { asset: true } });
  if (!row || row.assetId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && row.asset.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (row.repairedAt) {
    return NextResponse.json({ error: "ALREADY_CLOSED" }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.assetMaintenance.update({ where: { id: row.id }, data: { repairedAt: new Date() } }),
    // If there are no other open maintenance rows, the asset can go back to "new".
    prisma.asset.update({ where: { id: row.assetId }, data: { status: "new" } }),
  ]);

  // Re-check: if other open maintenance rows exist, keep asset in repair.
  const otherOpen = await prisma.assetMaintenance.count({
    where: { assetId: row.assetId, repairedAt: null, id: { not: row.id } },
  });
  if (otherOpen > 0) {
    await prisma.asset.update({ where: { id: row.assetId }, data: { status: "repair" } });
  }

  await audit({
    userId: session.userId,
    action: "asset.maintenance_close",
    tableName: "assetMaintenance",
    rowId: row.id,
    after: { closedAt: new Date(), assetId: row.assetId },
  });

  return NextResponse.json({ ok: true });
}
