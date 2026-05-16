import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createAssetSchema, generateAssetCode } from "@/lib/schemas/asset";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "asset.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "inventory");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  if (!session.centreId && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) return NextResponse.json({ error: "centreId required" }, { status: 400 });

  const qrCode = await generateAssetCode(d.category);

  const asset = await prisma.asset.create({
    data: {
      centreId,
      category: d.category,
      subcategory: d.subcategory || null,
      name: d.name,
      brand: d.brand || null,
      qrCode,
      status: "new",
      purchaseDate: d.purchaseDate ? new Date(d.purchaseDate) : null,
      cost: d.cost ?? null,
      notes: d.notes || null,
    },
  });

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "asset",
    rowId: asset.id,
    after: { name: asset.name, category: asset.category, qrCode: asset.qrCode },
  });

  return NextResponse.json({ id: asset.id, qrCode: asset.qrCode });
}
