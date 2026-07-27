import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { reviewLeaveRequestSchema } from "@/lib/schemas/leave-request";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// PATCH — review (approve | reject) a pending request. Approver gets recorded.
// A request can also be cancelled by the requester while it's still pending.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "leave-requests");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const existing = await prisma.leaveRequest.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence8 = await centreFence(session, existing.centreId);
  if (fence8) {
    return NextResponse.json({ error: fence8 }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // Self-cancel path: requester sends { decision: "cancelled" } while status === pending.
  if ((body as { decision?: string }).decision === "cancelled") {
    if (existing.userId !== session.userId) {
      return NextResponse.json({ error: "FORBIDDEN_NOT_REQUESTER" }, { status: 403 });
    }
    if (existing.status !== "pending") {
      return NextResponse.json({ error: "NOT_PENDING" }, { status: 409 });
    }
    const updated = await prisma.leaveRequest.update({
      where: { id: existing.id },
      data: { status: "cancelled" },
    });
    await audit({
      userId: session.userId,
      action: "leave.cancel",
      tableName: "leaveRequest",
      rowId: existing.id,
      before: { status: existing.status },
      after: { status: updated.status },
    });
    return NextResponse.json({ ok: true, status: updated.status });
  }

  // Otherwise: an approver decision.
  if (!can(session.role, "leave.approve")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const parsed = reviewLeaveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  if (existing.status !== "pending") {
    return NextResponse.json({ error: "NOT_PENDING" }, { status: 409 });
  }

  const updated = await prisma.leaveRequest.update({
    where: { id: existing.id },
    data: {
      status: parsed.data.decision,
      reviewedBy: session.userId,
      reviewedAt: new Date(),
      reviewNotes: parsed.data.reviewNotes || null,
    },
  });

  await audit({
    userId: session.userId,
    action: `leave.${parsed.data.decision}`,
    tableName: "leaveRequest",
    rowId: existing.id,
    before: { status: existing.status },
    after: { status: updated.status, reviewNotes: updated.reviewNotes },
  });

  // Notify the requester of the outcome.
  await notify({
    userId: existing.userId,
    centreId: existing.centreId,
    type: `leave.${parsed.data.decision}`,
    title: `Leave ${parsed.data.decision}`,
    body: parsed.data.reviewNotes
      ? `Decision: ${parsed.data.decision}. Note: ${parsed.data.reviewNotes}`
      : `Your leave request was ${parsed.data.decision}.`,
    link: `/leave-requests`,
    payload: { leaveRequestId: existing.id },
  });

  return NextResponse.json({ ok: true, status: updated.status });
}
