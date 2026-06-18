import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { recordDoseSchema } from "@/lib/schemas/vaccination";
import { parseWallTimeInTz } from "@/lib/tz";

// POST /api/vaccinations/[id]/dose — record that the dose was administered
// today (or on the supplied givenAt date). Re-stamps lastGivenAt and rolls
// nextDueAt forward by `intervalDays`.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "vet-records");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = recordDoseSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await prisma.vaccinationSchedule.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && row.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // Parse a supplied date-only givenAt against the centre's zone so "given
  // today" doesn't land on the previous calendar day (UTC midnight = prior
  // evening locally for IST-like zones).
  const centre = await prisma.centre.findUnique({ where: { id: row.centreId }, select: { timezone: true } });
  const tz = centre?.timezone ?? "Asia/Kolkata";
  const givenAt = parsed.data.givenAt ? parseWallTimeInTz(parsed.data.givenAt, tz) : new Date();
  const nextDueAt = new Date(givenAt.getTime() + row.intervalDays * 86400000);

  await prisma.vaccinationSchedule.update({
    where: { id: row.id },
    data: { lastGivenAt: givenAt, nextDueAt, notes: parsed.data.notes ?? row.notes },
  });

  await audit({
    userId: session.userId,
    action: "vaccination.dose_recorded",
    tableName: "vaccinationSchedule",
    rowId: row.id,
    before: { lastGivenAt: row.lastGivenAt, nextDueAt: row.nextDueAt },
    after: { lastGivenAt: givenAt, nextDueAt },
  });

  return NextResponse.json({ ok: true, nextDueAt });
}
