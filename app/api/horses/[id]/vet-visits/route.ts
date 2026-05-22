import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createVetVisitSchema } from "@/lib/schemas/vet-visit";

// GET — visits ordered newest first. Includes prescriptions + vet name so
// the timeline UI can render without a second round-trip.
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
  if (session.role !== "SUPER_ADMIN" && horse.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const visits = await prisma.vetVisit.findMany({
    where: { horseId: params.id },
    orderBy: { visitDate: "desc" },
    include: {
      vet: { select: { id: true, name: true } },
      prescriptions: true,
    },
    take: 100,
  });
  return NextResponse.json({ visits });
}

// POST — record a new vet visit + prescriptions in one transaction. Only
// VET (and CENTRE_MANAGER / SUPER_ADMIN for back-dated catch-up entries)
// can create. Prescribing without writing a visit is not allowed — the
// notes are mandatory so a regulator can always answer "why was this
// drug given?"
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.prescribe") && !can(session.role, "horse.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const featureBlock = await blockIfFeatureOff(session, "vet-records");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, name: true },
  });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && horse.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createVetVisitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Validate that any referenced medicineId belongs to this centre — block
  // a hostile client from linking a prescription to another club's medicine.
  const medIds = parsed.data.prescriptions
    .map((p) => p.medicineId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (medIds.length > 0) {
    const meds = await prisma.medicine.findMany({
      where: { id: { in: medIds }, centreId: horse.centreId },
      select: { id: true },
    });
    if (meds.length !== new Set(medIds).size) {
      return NextResponse.json({ error: "INVALID_MEDICINE" }, { status: 400 });
    }
  }

  const visit = await prisma.vetVisit.create({
    data: {
      centreId: horse.centreId,
      horseId: horse.id,
      vetUserId: session.userId,
      visitDate: parsed.data.visitDate ? new Date(parsed.data.visitDate) : new Date(),
      reason: parsed.data.reason ?? null,
      notes: parsed.data.notes,
      followUpAt: parsed.data.followUpAt ? new Date(parsed.data.followUpAt) : null,
      prescriptions: {
        create: parsed.data.prescriptions.map((p) => ({
          medicineId: p.medicineId || null,
          medicineName: p.medicineName,
          dose: p.dose,
          route: p.route ?? null,
          durationDays: p.durationDays ?? null,
          frequency: p.frequency ?? null,
          notes: p.notes ?? null,
        })),
      },
    },
    include: { prescriptions: true },
  });

  await audit({
    userId: session.userId,
    action: "vet.visit",
    tableName: "vetVisit",
    rowId: visit.id,
    after: {
      horseId: horse.id,
      horseName: horse.name,
      prescriptionCount: visit.prescriptions.length,
    },
  });

  return NextResponse.json({ ok: true, visit });
}
