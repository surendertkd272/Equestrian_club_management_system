// Create a fee plan for the scoped centre. Manage = SUPER_ADMIN / ADMIN /
// CENTRE_MANAGER. Was seed-only before.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { scopeCentre } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createFeePlanSchema, canManageCatalog } from "@/lib/schemas/catalog";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "club-catalog");
  if (featureBlock) return featureBlock;
  if (!canManageCatalog(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const centreId = scopeCentre(session);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = createFeePlanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });

  try {
    const row = await prisma.feePlan.create({
      data: {
        centreId,
        levelName: parsed.data.levelName,
        monthlyAmount: parsed.data.monthlyAmount,
        registrationAmount: parsed.data.registrationAmount,
      },
    });
    await audit({ userId: session.userId, action: "fee_plan.create", tableName: "feePlan", rowId: row.id, after: parsed.data });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: any) {
    if (e.code === "P2002") return NextResponse.json({ error: "DUPLICATE_LEVEL" }, { status: 409 });
    throw e;
  }
}
