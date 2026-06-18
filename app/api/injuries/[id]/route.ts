import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { addTreatmentSchema, updateInjuryStatusSchema } from "@/lib/schemas/injury";

// PATCH — either append a treatment entry (body.treatment present) or update
// status (body.status present). One endpoint for both since the UI flows
// share a request shape.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "injuries");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const row = await prisma.injuryLog.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && row.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body?.treatment !== undefined) {
    const parsed = addTreatmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
    }
    // treatmentJson is a jsonb column — Prisma returns the parsed array
    // directly. We append the new entry and write the array back as-is.
    const existing: Array<Record<string, unknown>> = Array.isArray(row.treatmentJson)
      ? (row.treatmentJson as Array<Record<string, unknown>>)
      : [];
    existing.push({
      at: parsed.data.at ?? new Date().toISOString(),
      by: session.userId,
      treatment: parsed.data.treatment,
      notes: parsed.data.notes ?? null,
    });
    await prisma.injuryLog.update({
      where: { id: row.id },
      data: { treatmentJson: existing as Prisma.InputJsonValue },
    });
    await audit({
      userId: session.userId,
      action: "injury.treatment_added",
      tableName: "injuryLog",
      rowId: row.id,
      after: { treatment: parsed.data.treatment },
    });
    return NextResponse.json({ ok: true });
  }

  // Status change path.
  const parsed = updateInjuryStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  // Stamp recoveredAt when moving to recovered, but never wipe an existing one
  // on a reopen — recovery history must survive a status change.
  const recoveredAt = parsed.data.status === "recovered"
    ? (parsed.data.recoveredAt ? new Date(parsed.data.recoveredAt) : (row.recoveredAt ?? new Date()))
    : row.recoveredAt;
  // Date sanity on a fresh recovery date: can't predate the injury, can't be in
  // the future (1-day grace absorbs date-only timezone-boundary parsing).
  if (parsed.data.status === "recovered" && parsed.data.recoveredAt) {
    if (recoveredAt!.getTime() < row.occurredAt.getTime()) {
      return NextResponse.json({ error: "RECOVERED_BEFORE_OCCURRED", message: "Recovery date can't be before the injury date." }, { status: 400 });
    }
    if (recoveredAt!.getTime() > Date.now() + 86_400_000) {
      return NextResponse.json({ error: "RECOVERED_IN_FUTURE", message: "Recovery date can't be in the future." }, { status: 400 });
    }
  }
  await prisma.injuryLog.update({
    where: { id: row.id },
    data: { status: parsed.data.status, recoveredAt },
  });
  await audit({
    userId: session.userId,
    action: "injury.status_changed",
    tableName: "injuryLog",
    rowId: row.id,
    before: { status: row.status },
    after: { status: parsed.data.status },
  });
  return NextResponse.json({ ok: true });
}
