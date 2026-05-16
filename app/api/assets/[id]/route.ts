import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateAssetSchema } from "@/lib/schemas/asset";
import { audit } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "asset.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const asset = await prisma.asset.findUnique({ where: { id: params.id } });
  if (!asset) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && asset.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const d = parsed.data;
  const updated = await prisma.asset.update({
    where: { id: asset.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.subcategory !== undefined ? { subcategory: d.subcategory || null } : {}),
      ...(d.brand !== undefined ? { brand: d.brand || null } : {}),
      ...(d.purchaseDate !== undefined
        ? { purchaseDate: d.purchaseDate ? new Date(d.purchaseDate) : null }
        : {}),
      ...(d.cost !== undefined ? { cost: d.cost ?? null } : {}),
      ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "update",
    tableName: "asset",
    rowId: asset.id,
    before: asset,
    after: updated,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "asset.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const asset = await prisma.asset.findUnique({ where: { id: params.id } });
  if (!asset) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && asset.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  await prisma.asset.delete({ where: { id: asset.id } });
  await audit({
    userId: session.userId,
    action: "delete",
    tableName: "asset",
    rowId: asset.id,
    before: asset,
  });
  return NextResponse.json({ ok: true });
}
