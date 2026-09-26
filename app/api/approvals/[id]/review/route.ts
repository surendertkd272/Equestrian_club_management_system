import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { reviewApprovalSchema } from "@/lib/schemas/approvals";
import { applyChangeRequest, isChangeKind, mayReviewChange } from "@/lib/change-requests";

// POST /api/approvals/[id]/review — approve / reject / cancel a pending request.
// "cancel" is the requester's own withdraw; everyone else needs leave.approve.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "approvals");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = reviewApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await prisma.approvalRequest.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence84 = await centreFence(session, row.centreId);
  if (fence84) {
    return NextResponse.json({ error: fence84 }, { status: 403 });
  }
  if (row.status !== "pending") {
    return NextResponse.json({ error: "ALREADY_REVIEWED", status: row.status }, { status: 409 });
  }

  const isChange = isChangeKind(row.entityType);

  // Authorisation: cancel needs to be the requester. Approving or rejecting a
  // coach's CHANGE needs a manager who isn't the requester; a generic request
  // keeps the old leave.approve rule.
  if (parsed.data.decision === "cancelled") {
    if (row.requestedBy !== session.userId) {
      return NextResponse.json({ error: "NOT_YOUR_REQUEST" }, { status: 403 });
    }
  } else if (isChange) {
    if (!mayReviewChange(session.role, row.requestedBy, session.userId)) {
      return NextResponse.json(
        {
          error: "FORBIDDEN",
          message:
            row.requestedBy === session.userId
              ? "You can't approve your own change."
              : "A coach's change has to be approved by a manager.",
        },
        { status: 403 },
      );
    }
  } else if (!can(session.role, "leave.approve")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // Claim the row before doing anything: two managers pressing Approve on the
  // same stock change must not apply it twice. Only the one whose conditional
  // update matches a still-pending row proceeds.
  const reviewedAt = new Date();
  const claim = await prisma.approvalRequest.updateMany({
    where: { id: row.id, status: "pending" },
    data: {
      status: parsed.data.decision,
      reviewedBy: session.userId,
      reviewedAt,
      reviewNotes: parsed.data.reviewNotes ?? null,
    },
  });
  if (claim.count === 0) {
    return NextResponse.json({ error: "ALREADY_REVIEWED" }, { status: 409 });
  }

  if (isChange && parsed.data.decision === "approved") {
    let result: Awaited<ReturnType<typeof applyChangeRequest>>;
    try {
      result = await applyChangeRequest(row);
    } catch (e) {
      result = { ok: false, error: "APPLY_FAILED", message: e instanceof Error ? e.message : "Could not apply." };
    }
    if (!result.ok) {
      // Put it back so it can be rejected (or retried once the cause is
      // fixed) rather than sitting "approved" with nothing applied.
      await prisma.approvalRequest.update({
        where: { id: row.id },
        data: { status: "pending", reviewedBy: null, reviewedAt: null, reviewNotes: null },
      });
      return NextResponse.json({ error: result.error, message: result.message }, { status: 409 });
    }
    await prisma.approvalRequest.update({ where: { id: row.id }, data: { appliedAt: new Date() } });
  }

  const updated = { status: parsed.data.decision, reviewNotes: parsed.data.reviewNotes ?? null };

  await audit({
    userId: session.userId,
    action: `approval.${parsed.data.decision}`,
    tableName: "approvalRequest",
    rowId: row.id,
    before: { status: row.status },
    after: { status: updated.status, reviewNotes: updated.reviewNotes },
  });

  // Tell the requester about the decision.
  if (parsed.data.decision !== "cancelled") {
    await notify({
      userId: row.requestedBy,
      centreId: row.centreId,
      type: `approval.${parsed.data.decision}`,
      title: `Your request was ${parsed.data.decision}`,
      body: row.title + (parsed.data.reviewNotes ? ` · ${parsed.data.reviewNotes}` : ""),
      link: "/approvals",
      payload: { approvalId: row.id },
    });
  }

  return NextResponse.json({ ok: true });
}
