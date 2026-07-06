import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateHorseSchema } from "@/lib/schemas/horse";
import { audit } from "@/lib/audit";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "horse.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateHorseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const horse = await prisma.horse.findUnique({ where: { id: params.id } });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role === "SUPER_ADMIN") {
    // Platform/HQ super-admin may edit any centre's horse — but only within
    // their own org, never another tenant's.
    const [callerOrg, rowOrg] = await Promise.all([
      getOrgIdForSession(session),
      getOrgIdForCentre(horse.centreId),
    ]);
    if (!callerOrg || callerOrg !== rowOrg) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
  } else if (horse.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const d = parsed.data;
  const updated = await prisma.horse.update({
    where: { id: horse.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.breed !== undefined ? { breed: d.breed || null } : {}),
      ...(d.sex !== undefined ? { sex: d.sex || null } : {}),
      ...(d.dob !== undefined ? { dob: d.dob ? new Date(d.dob) : null } : {}),
      ...(d.ageYears !== undefined ? { ageYears: d.ageYears ?? null } : {}),
      ...(d.heightIn !== undefined ? { heightIn: d.heightIn ?? null } : {}),
      ...(d.microchip !== undefined ? { microchip: d.microchip || null } : {}),
      ...(d.efiHorseId !== undefined ? { efiHorseId: d.efiHorseId || null } : {}),
      ...(d.homeClub !== undefined ? { homeClub: d.homeClub || null } : {}),
      ...(d.ownership !== undefined ? { ownership: d.ownership } : {}),
      ...(d.stableNo !== undefined ? { stableNo: d.stableNo || null } : {}),
      ...(d.diet !== undefined ? { diet: d.diet || null } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.insurerName !== undefined ? { insurerName: d.insurerName || null } : {}),
      ...(d.insurancePolicyNo !== undefined ? { insurancePolicyNo: d.insurancePolicyNo || null } : {}),
      ...(d.insurancePremium !== undefined ? { insurancePremium: d.insurancePremium ?? null } : {}),
      ...(d.insuranceValidFrom !== undefined
        ? { insuranceValidFrom: d.insuranceValidFrom ? new Date(d.insuranceValidFrom) : null }
        : {}),
      ...(d.insuranceValidTo !== undefined
        ? { insuranceValidTo: d.insuranceValidTo ? new Date(d.insuranceValidTo) : null }
        : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "update",
    tableName: "horse",
    rowId: horse.id,
    before: horse,
    after: updated,
  });

  return NextResponse.json({ ok: true });
}
