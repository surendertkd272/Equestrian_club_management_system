import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { centreScopeWhere } from "@/lib/authz-centre";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createFarrierVisitSchema } from "@/lib/schemas/farrier";

// GET — list farrier visits. Optional ?horseId, ?status.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "farriery");
  if (featureBlock) return featureBlock;

  const url = new URL(req.url);
  const horseId = url.searchParams.get("horseId");
  const status = url.searchParams.get("status");

  const where: Prisma.FarrierVisitWhereInput = {};
  // Centre-less roles fall straight through a `role !== "SUPER_ADMIN" &&
  // session.centreId` conjunct with NO filter applied, so this list spanned
  // every organisation on the platform. Same scope the pages use.
  const scope = await centreScopeWhere(session);
  if (!scope) return NextResponse.json({ error: "FORBIDDEN_NO_SCOPE" }, { status: 403 });
  Object.assign(where, scope);
  if (horseId) where.horseId = horseId;
  if (status) where.status = status;

  const visits = await prisma.farrierVisit.findMany({
    where,
    orderBy: { scheduledAt: "desc" },
    take: 200,
    include: { horse: { select: { id: true, name: true, stableNo: true } } },
  });
  return NextResponse.json({ visits });
}

// POST — schedule a new farrier visit. Permission: horse.manage (the same
// role bucket that touches stable + horse-related records).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "farriery.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "farriery");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createFarrierVisitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const horse = await prisma.horse.findUnique({
    where: { id: d.horseId },
    select: { id: true, centreId: true, name: true },
  });
  if (!horse) return NextResponse.json({ error: "HORSE_NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence88 = await centreFence(session, horse.centreId);
  if (fence88) {
    return NextResponse.json({ error: fence88 }, { status: 403 });
  }

  const visit = await prisma.farrierVisit.create({
    data: {
      centreId: horse.centreId,
      horseId: horse.id,
      farrierName: d.farrierName,
      farrierUserId: d.farrierUserId ?? null,
      scheduledAt: new Date(d.scheduledAt),
      workType: d.workType,
      hoofNotes: d.hoofNotes ?? null,
      cost: d.cost ?? null,
      createdBy: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "farrier.scheduled",
    tableName: "farrierVisit",
    rowId: visit.id,
    after: { horseId: horse.id, horseName: horse.name, scheduledAt: visit.scheduledAt, workType: visit.workType },
  });

  return NextResponse.json({ ok: true, id: visit.id });
}
