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

  // Authorisation: cancel needs to be the requester; approve/reject needs leave.approve perm.
  if (parsed.data.decision === "cancelled") {
    if (row.requestedBy !== session.userId) {
      return NextResponse.json({ error: "NOT_YOUR_REQUEST" }, { status: 403 });
    }
  } else {
    if (!can(session.role, "leave.approve")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
  }

  const updated = await prisma.approvalRequest.update({
    where: { id: row.id },
    data: {
      status: parsed.data.decision,
      reviewedBy: session.userId,
      reviewedAt: new Date(),
      reviewNotes: parsed.data.reviewNotes ?? null,
    },
  });

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
