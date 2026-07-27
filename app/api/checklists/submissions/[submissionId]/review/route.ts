// Stable-manager countersign on a filed checklist submission — the digital
// equivalent of the PDF's "Stable Manager Signature" line. Stamps
// reviewedByUserId + reviewedAt. Idempotent (re-signing just refreshes it).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// Who can countersign — the stable manager + centre management tiers.
const CAN_REVIEW = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "STABLE_MANAGER", "HEAD_COACH"]);

export async function POST(req: NextRequest, { params }: { params: { submissionId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_REVIEW.has(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const sub = await prisma.checklistSubmission.findUnique({
    where: { id: params.submissionId },
    select: { id: true, centreId: true, reviewedByUserId: true, reviewedAt: true },
  });
  if (!sub) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  // isHQ alone let an HQ caller of ANY organisation through. centreFence
  // keeps the centre rule and adds the org rule HQ never had.
  const fence = await centreFence(session, sub.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }

  const updated = await prisma.checklistSubmission.update({
    where: { id: sub.id },
    data: { reviewedByUserId: session.userId, reviewedAt: new Date() },
    select: { reviewedAt: true },
  });

  await audit({
    userId: session.userId,
    action: "checklist.review",
    tableName: "checklistSubmission",
    rowId: sub.id,
    // Keep the prior countersign in `before` so re-signing doesn't erase who
    // signed first — the manager-signature line stays auditable.
    before: { reviewedByUserId: sub.reviewedByUserId, reviewedAt: sub.reviewedAt },
    after: { reviewedByUserId: session.userId, reviewedAt: updated.reviewedAt },
  });

  return NextResponse.json({ ok: true, reviewedAt: updated.reviewedAt });
}
