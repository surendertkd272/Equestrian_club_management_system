// Advance a requisition through the manager → accountant flow, or reject
// at either stage. The caller's role determines which transition they're
// authorised to perform; the API rejects mismatches (manager-approver
// trying to sign off on pending_accountant, etc).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decideRequisitionSchema } from "@/lib/schemas/requisition";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = decideRequisitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await prisma.requisition.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && row.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  if (row.stage !== "pending_manager" && row.stage !== "pending_accountant") {
    return NextResponse.json({ error: "ALREADY_DECIDED", stage: row.stage }, { status: 409 });
  }

  // Authorisation check + transition.
  let nextStage: string;
  let updateData: any = {};
  const now = new Date();
  if (row.stage === "pending_manager") {
    if (!can(session.role, "requisition.approve_manager")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    updateData.managerDecidedByUserId = session.userId;
    updateData.managerDecidedAt = now;
    updateData.managerNotes = parsed.data.notes ?? null;
    if (parsed.data.decision === "approve") {
      nextStage = "pending_accountant";
    } else {
      nextStage = "rejected";
      updateData.rejectedReason = parsed.data.notes ?? "Rejected at manager stage";
    }
  } else {
    if (!can(session.role, "requisition.approve_accountant")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    updateData.accountantDecidedByUserId = session.userId;
    updateData.accountantDecidedAt = now;
    updateData.accountantNotes = parsed.data.notes ?? null;
    if (parsed.data.decision === "approve") {
      nextStage = "approved";
    } else {
      nextStage = "rejected";
      updateData.rejectedReason = parsed.data.notes ?? "Rejected at accountant stage";
    }
  }
  updateData.stage = nextStage;

  const updated = await prisma.requisition.update({
    where: { id: row.id },
    data: updateData,
  });

  await audit({
    userId: session.userId,
    action: `requisition.${parsed.data.decision}`,
    tableName: "requisition",
    rowId: row.id,
    before: { stage: row.stage },
    after: { stage: updated.stage },
  });

  return NextResponse.json({ ok: true, stage: updated.stage });
}
