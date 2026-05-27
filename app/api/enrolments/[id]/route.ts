// Approve or reject a self-enrolled rider. Approval flips the rider from
// pending_approval → pending_payment and creates the registration invoice
// (the same invoice the onboarding flow used to create up-front). Rejection
// flips to "rejected". Permission: SUPER_ADMIN, ADMIN, CENTRE_MANAGER,
// SCHOOL_ADMINISTRATOR.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { z } from "zod";

const APPROVER_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "SCHOOL_ADMINISTRATOR"]);

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(300).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!APPROVER_ROLES.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const rider = await prisma.rider.findUnique({ where: { id: params.id } });
  if (!rider) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Centre-scoped approvers can only act on their own club.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== rider.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (rider.status !== "pending_approval") {
    return NextResponse.json({ error: "NOT_PENDING_APPROVAL", current: rider.status }, { status: 409 });
  }

  if (parsed.data.action === "reject") {
    await prisma.rider.update({
      where: { id: rider.id },
      data: { status: "rejected", approvedByUserId: session.userId, approvedAt: new Date() },
    });
    await audit({
      userId: session.userId,
      action: "enrolment.reject",
      tableName: "rider",
      rowId: rider.id,
      before: { status: "pending_approval" },
      after: { status: "rejected", reason: parsed.data.reason ?? null },
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // Approve → create the registration invoice + move to pending_payment.
  const regPlan = await prisma.feePlan.findFirst({ where: { centreId: rider.centreId } });
  const regAmount = regPlan?.registrationAmount ?? 3000;

  const invoice = await prisma.$transaction(async (tx) => {
    await tx.rider.update({
      where: { id: rider.id },
      data: { status: "pending_payment", approvedByUserId: session.userId, approvedAt: new Date() },
    });
    return tx.invoice.create({
      data: {
        centreId: rider.centreId,
        riderId: rider.id,
        amount: regAmount,
        gstAmount: 0,
        dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
        kind: "registration",
        status: "due",
      },
    });
  });

  await audit({
    userId: session.userId,
    action: "enrolment.approve",
    tableName: "rider",
    rowId: rider.id,
    before: { status: "pending_approval" },
    after: { status: "pending_payment", invoiceId: invoice.id, regAmount },
  });

  return NextResponse.json({ ok: true, status: "pending_payment", invoiceId: invoice.id, amount: regAmount });
}
