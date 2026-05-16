import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { returnAssetSchema } from "@/lib/schemas/asset";
import { audit } from "@/lib/audit";
import { notifyCentreManager } from "@/lib/notify";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; issueId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "asset.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = returnAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const issuance = await prisma.assetIssuance.findUnique({
    where: { id: params.issueId },
    include: { asset: true },
  });
  if (!issuance || issuance.assetId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (session.role !== "SUPER_ADMIN" && issuance.asset.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (issuance.returnedAt) {
    return NextResponse.json({ error: "ALREADY_RETURNED" }, { status: 409 });
  }

  const cond = parsed.data.conditionAtReturn;
  const newAssetStatus = cond === "damaged" || cond === "lost" ? "repair" : "new";

  const txOps = [
    prisma.assetIssuance.update({
      where: { id: issuance.id },
      data: {
        returnedAt: new Date(),
        returnedBy: session.userId,
        conditionAtReturn: cond,
        note: parsed.data.note ? `${issuance.note ? issuance.note + " · " : ""}return: ${parsed.data.note}` : issuance.note,
      },
    }),
    prisma.asset.update({ where: { id: issuance.assetId }, data: { status: newAssetStatus } }),
  ];

  // Damaged/lost: auto-open a maintenance row so it shows up in the repair queue.
  if (cond === "damaged" || cond === "lost") {
    txOps.push(
      prisma.assetMaintenance.create({
        data: {
          assetId: issuance.assetId,
          issue: cond === "lost" ? `Reported lost on return: ${parsed.data.note ?? ""}` : `Damaged on return: ${parsed.data.note ?? ""}`,
          createdBy: session.userId,
        },
      }) as any,
    );
  }

  await prisma.$transaction(txOps);

  await audit({
    userId: session.userId,
    action: "asset.return",
    tableName: "assetIssuance",
    rowId: issuance.id,
    before: issuance,
    after: { conditionAtReturn: cond, newAssetStatus },
  });

  if (cond === "damaged" || cond === "lost") {
    await notifyCentreManager(issuance.asset.centreId, {
      type: "asset.damage",
      title: `${issuance.asset.name} returned ${cond}`,
      body: `Maintenance ticket auto-opened. ${parsed.data.note ?? ""}`.trim(),
      link: `/tack/${issuance.assetId}`,
      payload: { assetId: issuance.assetId, issuanceId: issuance.id, condition: cond },
    });
  }

  return NextResponse.json({ ok: true, newAssetStatus });
}
