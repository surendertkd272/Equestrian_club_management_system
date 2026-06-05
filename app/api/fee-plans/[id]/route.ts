import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { updateFeePlanSchema, canManageCatalog } from "@/lib/schemas/catalog";

async function load(id: string, session: { role: string; centreId: string | null }) {
  const row = await prisma.feePlan.findUnique({ where: { id } });
  if (!row) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && row.centreId !== session.centreId) {
    return { error: NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 }) };
  }
  return { row };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "club-catalog");
  if (featureBlock) return featureBlock;
  if (!canManageCatalog(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { row, error } = await load(params.id, session);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = updateFeePlanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });

  await prisma.feePlan.update({
    where: { id: row!.id },
    data: {
      ...(parsed.data.levelName !== undefined ? { levelName: parsed.data.levelName } : {}),
      ...(parsed.data.monthlyAmount !== undefined ? { monthlyAmount: parsed.data.monthlyAmount } : {}),
      ...(parsed.data.registrationAmount !== undefined ? { registrationAmount: parsed.data.registrationAmount } : {}),
    },
  });
  await audit({ userId: session.userId, action: "fee_plan.update", tableName: "feePlan", rowId: row!.id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "club-catalog");
  if (featureBlock) return featureBlock;
  if (!canManageCatalog(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { row, error } = await load(params.id, session);
  if (error) return error;

  // Invoices reference levelName as free text, not an FK — safe to hard-delete.
  await prisma.feePlan.delete({ where: { id: row!.id } });
  await audit({ userId: session.userId, action: "fee_plan.delete", tableName: "feePlan", rowId: row!.id });
  return NextResponse.json({ ok: true });
}
