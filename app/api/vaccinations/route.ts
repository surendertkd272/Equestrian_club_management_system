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
import {
  upsertScheduleSchema,
  DEFAULT_INTERVAL_DAYS,
} from "@/lib/schemas/vaccination";

// GET — list every schedule for the caller's centre (or one horse via ?horseId).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "vet-records");
  if (featureBlock) return featureBlock;

  const url = new URL(req.url);
  const horseId = url.searchParams.get("horseId");

  const where: Prisma.VaccinationScheduleWhereInput = {};
  // Centre-less roles fall straight through a `role !== "SUPER_ADMIN" &&
  // session.centreId` conjunct with NO filter applied, so this list spanned
  // every organisation on the platform. Same scope the pages use.
  const scope = await centreScopeWhere(session);
  if (!scope) return NextResponse.json({ error: "FORBIDDEN_NO_SCOPE" }, { status: 403 });
  Object.assign(where, scope);
  if (horseId) where.horseId = horseId;

  const rows = await prisma.vaccinationSchedule.findMany({
    where,
    orderBy: { nextDueAt: "asc" },
    include: { horse: { select: { id: true, name: true, stableNo: true } } },
    take: 300,
  });
  return NextResponse.json({ rows });
}

// POST — create or update (per horseId + vaccineKey) the vaccination plan.
// Permission piggy-backs medicine.manage since the vet runs this.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "vet-records");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = upsertScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const horse = await prisma.horse.findUnique({
    where: { id: d.horseId },
    select: { centreId: true },
  });
  if (!horse) return NextResponse.json({ error: "HORSE_NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence88 = await centreFence(session, horse.centreId);
  if (fence88) {
    return NextResponse.json({ error: fence88 }, { status: 403 });
  }

  const intervalDays = d.intervalDays ?? DEFAULT_INTERVAL_DAYS[d.vaccineKey];
  // nextDueAt resolution order: explicit nextDueAt > lastGivenAt + interval >
  // firstDueAt > today + interval (i.e. "I added this vaccine today").
  let nextDueAt: Date;
  if (d.nextDueAt) {
    nextDueAt = new Date(d.nextDueAt);
  } else if (d.lastGivenAt) {
    nextDueAt = new Date(new Date(d.lastGivenAt).getTime() + intervalDays * 86400000);
  } else if (d.firstDueAt) {
    nextDueAt = new Date(d.firstDueAt);
  } else {
    nextDueAt = new Date(Date.now() + intervalDays * 86400000);
  }

  const row = await prisma.vaccinationSchedule.upsert({
    where: { horseId_vaccineKey: { horseId: d.horseId, vaccineKey: d.vaccineKey } },
    create: {
      centreId: horse.centreId,
      horseId: d.horseId,
      vaccineKey: d.vaccineKey,
      vaccineLabel: d.vaccineLabel,
      intervalDays,
      firstDueAt: d.firstDueAt ? new Date(d.firstDueAt) : null,
      lastGivenAt: d.lastGivenAt ? new Date(d.lastGivenAt) : null,
      nextDueAt,
      notes: d.notes ?? null,
    },
    update: {
      vaccineLabel: d.vaccineLabel,
      intervalDays,
      firstDueAt: d.firstDueAt ? new Date(d.firstDueAt) : null,
      lastGivenAt: d.lastGivenAt ? new Date(d.lastGivenAt) : null,
      nextDueAt,
      notes: d.notes ?? null,
    },
  });

  await audit({
    userId: session.userId,
    action: "vaccination.upsert",
    tableName: "vaccinationSchedule",
    rowId: row.id,
    after: { horseId: d.horseId, vaccineKey: d.vaccineKey, nextDueAt },
  });

  return NextResponse.json({ ok: true, id: row.id, nextDueAt });
}
