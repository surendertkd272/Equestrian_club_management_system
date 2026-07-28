import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createHealthLogSchema } from "@/lib/schemas/horse-health";

// GET — return the last 60 health logs for this horse (≈ 60 days of daily
// readings). The chart UI displays them as a sparkline.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "vet-records");
  if (featureBlock) return featureBlock;

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    select: { centreId: true },
  });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence88 = await centreFence(session, horse.centreId);
  if (fence88) {
    return NextResponse.json({ error: fence88 }, { status: 403 });
  }

  const logs = await prisma.horseHealthLog.findMany({
    where: { horseId: params.id },
    orderBy: { recordedAt: "desc" },
    take: 60,
  });
  return NextResponse.json({ logs });
}

// POST — append a new health-check row.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // Vet + stable manager + manager can record vitals. Grooms can if the club
  // wants — we gate by horse.manage which already includes them.
  if (!can(session.role, "horse.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "vet-records");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, name: true },
  });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence88 = await centreFence(session, horse.centreId);
  if (fence88) {
    return NextResponse.json({ error: fence88 }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createHealthLogSchema.safeParse({ ...body, horseId: horse.id });
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const log = await prisma.horseHealthLog.create({
    data: {
      horseId: horse.id,
      centreId: horse.centreId,
      recordedAt: parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : new Date(),
      recordedBy: session.userId,
      tempC: parsed.data.tempC ?? null,
      heartRateBpm: parsed.data.heartRateBpm ?? null,
      respirationRpm: parsed.data.respirationRpm ?? null,
      weightKg: parsed.data.weightKg ?? null,
      appetite: parsed.data.appetite ?? null,
      manure: parsed.data.manure ?? null,
      notes: parsed.data.notes ?? null,
    },
  });

  await audit({
    userId: session.userId,
    action: "horse.health_log",
    tableName: "horseHealthLog",
    rowId: log.id,
    after: {
      horseId: horse.id,
      horseName: horse.name,
      tempC: log.tempC,
      heartRateBpm: log.heartRateBpm,
    },
  });

  return NextResponse.json({ ok: true, id: log.id });
}
