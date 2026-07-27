import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import {
  completeFarrierVisitSchema,
  DEFAULT_FARRIER_INTERVAL_DAYS,
} from "@/lib/schemas/farrier";

// POST /api/farrier/[id]/complete — close out a scheduled visit. Records
// completion timestamp + optional notes + cost, and computes the next-due
// date (default = +6 weeks) unless the farrier overrides it.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "farriery.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "farriery");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = completeFarrierVisitSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const visit = await prisma.farrierVisit.findUnique({ where: { id: params.id } });
  if (!visit) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence42 = await centreFence(session, visit.centreId);
  if (fence42) {
    return NextResponse.json({ error: fence42 }, { status: 403 });
  }
  if (visit.status === "completed") {
    return NextResponse.json({ error: "ALREADY_COMPLETED" }, { status: 409 });
  }

  const completedAt = parsed.data.completedAt ? new Date(parsed.data.completedAt) : new Date();
  const nextDueAt = parsed.data.nextDueAt
    ? new Date(parsed.data.nextDueAt)
    : new Date(completedAt.getTime() + DEFAULT_FARRIER_INTERVAL_DAYS * 86400000);

  const updated = await prisma.farrierVisit.update({
    where: { id: visit.id },
    data: {
      completedAt,
      hoofNotes: parsed.data.hoofNotes ?? visit.hoofNotes,
      cost: parsed.data.cost ?? visit.cost,
      nextDueAt,
      status: "completed",
    },
  });

  await audit({
    userId: session.userId,
    action: "farrier.completed",
    tableName: "farrierVisit",
    rowId: visit.id,
    before: { status: visit.status },
    after: { status: updated.status, completedAt: updated.completedAt, nextDueAt: updated.nextDueAt },
  });

  return NextResponse.json({ ok: true, nextDueAt });
}
