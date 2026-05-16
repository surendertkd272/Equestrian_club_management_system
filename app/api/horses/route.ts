import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createHorseSchema } from "@/lib/schemas/horse";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "horse.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "horse-management");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  if (!session.centreId && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createHorseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) return NextResponse.json({ error: "centreId required" }, { status: 400 });

  const horse = await prisma.horse.create({
    data: {
      centreId,
      name: parsed.data.name,
      breed: parsed.data.breed || null,
      sex: parsed.data.sex || null,
      ageYears: parsed.data.ageYears ?? null,
      heightHh: parsed.data.heightHh ?? null,
      microchip: parsed.data.microchip || null,
      ownership: parsed.data.ownership,
      stableNo: parsed.data.stableNo || null,
      diet: parsed.data.diet || null,
      insurerName: parsed.data.insurerName || null,
      insurancePolicyNo: parsed.data.insurancePolicyNo || null,
      insurancePremium: parsed.data.insurancePremium ?? null,
      insuranceValidFrom: parsed.data.insuranceValidFrom ? new Date(parsed.data.insuranceValidFrom) : null,
      insuranceValidTo: parsed.data.insuranceValidTo ? new Date(parsed.data.insuranceValidTo) : null,
    },
  });

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "horse",
    rowId: horse.id,
    after: { name: horse.name, ownership: horse.ownership },
  });

  return NextResponse.json({ id: horse.id });
}
