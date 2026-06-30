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
import { notify, notifyMany } from "@/lib/notify";

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

  // Stage-transition notifications. Each branch picks recipients matching
  // the new owners of the workflow + always echoes back to the submitter
  // on terminal outcomes (approved / rejected) so they don't have to poll.
  if (updated.stage === "pending_accountant") {
    // Manager approved → ping accountants who can sign off.
    const accountants = await prisma.user.findMany({
      where: {
        centreId: row.centreId,
        status: "active",
        role: { in: ["ACCOUNTANT", "SUPER_ADMIN"] },
      },
      select: { id: true },
    });
    await notifyMany(accountants.map((u) => u.id), {
      centreId: row.centreId,
      type: "requisition.pending_accountant",
      title: "Requisition awaiting accountant sign-off",
      body: `${session.name} (${session.role.replaceAll("_", " ").toLowerCase()}) approved a requisition for ₹${Math.round(row.totalEstimatedCost).toLocaleString("en-IN")}. Your turn.`,
      link: "/requisitions",
    });
  } else if (updated.stage === "approved" || updated.stage === "rejected") {
    // Terminal — tell the submitter.
    await notify({
      userId: row.requestedByUserId,
      centreId: row.centreId,
      type: `requisition.${updated.stage}`,
      title: `Requisition ${updated.stage}`,
      body: updated.stage === "approved"
        ? `Your requisition for ₹${Math.round(row.totalEstimatedCost).toLocaleString("en-IN")} was fully approved — proceed with procurement.`
        : `Your requisition was rejected${parsed.data.notes ? `: ${parsed.data.notes}` : "."}`,
      link: "/requisitions",
    });
  }

  return NextResponse.json({ ok: true, stage: updated.stage });
}
