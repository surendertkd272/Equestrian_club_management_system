// Coach marks a rider's rating for a monthly skill. One mark per
// (catalogId, riderId) thanks to the unique constraint — upsert handles
// the re-mark case without a second round-trip.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { markSkillSchema } from "@/lib/schemas/monthly-skill";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "skill-tracking");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "progress.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = markSkillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Verify the catalog row exists + same centre as the rider.
  const [catalog, rider] = await Promise.all([
    prisma.monthlySkillCatalog.findUnique({
      where: { id: parsed.data.catalogId },
      select: { id: true, centreId: true, active: true },
    }),
    prisma.rider.findUnique({
      where: { id: parsed.data.riderId },
      select: { id: true, centreId: true },
    }),
  ]);
  if (!catalog || !rider) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (!catalog.active) {
    return NextResponse.json({ error: "SKILL_INACTIVE" }, { status: 400 });
  }
  if (catalog.centreId !== rider.centreId) {
    return NextResponse.json({ error: "CENTRE_MISMATCH" }, { status: 400 });
  }
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== catalog.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const mark = await prisma.monthlySkillMark.upsert({
    where: {
      catalogId_riderId: {
        catalogId: parsed.data.catalogId,
        riderId: parsed.data.riderId,
      },
    },
    create: {
      catalogId: parsed.data.catalogId,
      riderId: parsed.data.riderId,
      rating: parsed.data.rating,
      coachNotes: parsed.data.coachNotes ?? null,
      markedByUserId: session.userId,
    },
    update: {
      rating: parsed.data.rating,
      coachNotes: parsed.data.coachNotes ?? null,
      markedByUserId: session.userId,
      markedAt: new Date(),
    },
  });

  await audit({
    userId: session.userId,
    action: "monthly_skill.mark",
    tableName: "monthlySkillMark",
    rowId: mark.id,
    after: { catalogId: mark.catalogId, riderId: mark.riderId, rating: mark.rating },
  });

  return NextResponse.json({ ok: true });
}
