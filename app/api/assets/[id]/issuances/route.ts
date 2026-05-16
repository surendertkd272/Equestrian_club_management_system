import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { issueAssetSchema } from "@/lib/schemas/asset";
import { audit } from "@/lib/audit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "asset.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = issueAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const asset = await prisma.asset.findUnique({ where: { id: params.id } });
  if (!asset) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && asset.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (asset.status === "retired") {
    return NextResponse.json({ error: "RETIRED", message: "Retired assets cannot be issued." }, { status: 409 });
  }
  if (asset.status === "repair") {
    return NextResponse.json({ error: "IN_REPAIR", message: "Asset is in repair — fix or recall it first." }, { status: 409 });
  }

  // Refuse if any prior issuance is still open (returnedAt is null).
  const open = await prisma.assetIssuance.findFirst({
    where: { assetId: asset.id, returnedAt: null },
  });
  if (open) {
    return NextResponse.json({ error: "ALREADY_ISSUED", message: "Return the current issuance before re-issuing." }, { status: 409 });
  }

  // Verify the recipient exists + matches the centre.
  if (d.issuedToUserId) {
    const u = await prisma.user.findUnique({ where: { id: d.issuedToUserId } });
    if (!u || (u.centreId && u.centreId !== asset.centreId)) {
      return NextResponse.json({ error: "INVALID_USER" }, { status: 400 });
    }
  }
  if (d.issuedToRiderId) {
    const r = await prisma.rider.findUnique({ where: { id: d.issuedToRiderId } });
    if (!r || r.centreId !== asset.centreId) {
      return NextResponse.json({ error: "INVALID_RIDER" }, { status: 400 });
    }
  }
  if (d.issuedToHorseId) {
    const h = await prisma.horse.findUnique({ where: { id: d.issuedToHorseId } });
    if (!h || h.centreId !== asset.centreId) {
      return NextResponse.json({ error: "INVALID_HORSE" }, { status: 400 });
    }
  }

  const [issuance] = await prisma.$transaction([
    prisma.assetIssuance.create({
      data: {
        assetId: asset.id,
        issuedToUserId: d.issuedToUserId ?? null,
        issuedToRiderId: d.issuedToRiderId ?? null,
        issuedToHorseId: d.issuedToHorseId ?? null,
        issuedBy: session.userId,
        note: d.note || null,
      },
    }),
    prisma.asset.update({ where: { id: asset.id }, data: { status: "in_use" } }),
  ]);

  await audit({
    userId: session.userId,
    action: "asset.issue",
    tableName: "assetIssuance",
    rowId: issuance.id,
    after: {
      assetId: asset.id,
      assetName: asset.name,
      issuedToUserId: d.issuedToUserId,
      issuedToRiderId: d.issuedToRiderId,
      issuedToHorseId: d.issuedToHorseId,
    },
  });

  return NextResponse.json({ id: issuance.id });
}
