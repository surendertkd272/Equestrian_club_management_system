// Record a staff member's monthly salary settlement. The headline feature
// (client ask): outstanding employee advances are auto-deducted from the
// salary — the deduction is split across the oldest-first open advances and
// written as AdvanceRepayment rows, flipping each advance's status. One
// SalaryPayment per (user, month); re-posting the same month is rejected.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { recordSalarySchema } from "@/lib/schemas/salary";

function canManagePayroll(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManagePayroll(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = recordSalarySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const staffUser = await prisma.user.findUnique({
    where: { id: d.userId },
    select: { id: true, centreId: true, name: true },
  });
  if (!staffUser || !staffUser.centreId) {
    return NextResponse.json({ error: "STAFF_NOT_FOUND" }, { status: 404 });
  }
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== staffUser.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const dup = await prisma.salaryPayment.findUnique({
    where: { userId_periodMonth: { userId: d.userId, periodMonth: d.periodMonth } },
  });
  if (dup) return NextResponse.json({ error: "ALREADY_RECORDED", month: d.periodMonth }, { status: 409 });

  // Open advances, oldest first — we recover from these in order.
  const openAdvances = await prisma.employeeAdvance.findMany({
    where: { userId: d.userId, status: { in: ["outstanding", "partially_repaid"] } },
    include: { repayments: { select: { amount: true } } },
    orderBy: { givenAt: "asc" },
  });
  const totalOutstanding = openAdvances.reduce((sum, a) => {
    const repaid = a.repayments.reduce((s, r) => s + r.amount, 0);
    return sum + Math.max(0, a.amount - repaid);
  }, 0);

  // Cap the deduction: can't exceed outstanding, can't exceed take-home.
  const maxDeductible = Math.max(0, d.grossAmount - d.otherDeductions);
  const advanceDeducted = Math.min(d.advanceDeduction, totalOutstanding, maxDeductible);
  const netAmount = d.grossAmount - d.otherDeductions - advanceDeducted;

  const result = await prisma.$transaction(async (tx) => {
    // Spread the deduction across open advances, oldest first.
    let remaining = advanceDeducted;
    for (const adv of openAdvances) {
      if (remaining <= 0.01) break;
      const repaid = adv.repayments.reduce((s, r) => s + r.amount, 0);
      const advRemaining = Math.max(0, adv.amount - repaid);
      if (advRemaining <= 0.01) continue;
      const take = Math.min(advRemaining, remaining);
      await tx.advanceRepayment.create({
        data: {
          advanceId: adv.id,
          amount: take,
          recordedByUserId: session.userId,
          notes: `Auto-deducted from ${d.periodMonth} salary`,
        },
      });
      const newStatus = repaid + take >= adv.amount - 0.01 ? "repaid" : "partially_repaid";
      await tx.employeeAdvance.update({ where: { id: adv.id }, data: { status: newStatus } });
      remaining -= take;
    }

    return tx.salaryPayment.create({
      data: {
        centreId: staffUser.centreId!,
        userId: d.userId,
        periodMonth: d.periodMonth,
        grossAmount: d.grossAmount,
        advanceDeducted,
        otherDeductions: d.otherDeductions,
        netAmount,
        method: d.method ?? null,
        paidAt: d.paid ? new Date() : null,
        notes: d.notes ?? null,
        recordedByUserId: session.userId,
      },
    });
  });

  await audit({
    userId: session.userId,
    action: "salary.record",
    tableName: "salaryPayment",
    rowId: result.id,
    after: { userId: d.userId, periodMonth: d.periodMonth, gross: d.grossAmount, advanceDeducted, net: netAmount },
  });

  if (advanceDeducted > 0) {
    await notify({
      userId: d.userId,
      centreId: staffUser.centreId,
      type: "salary.advance_deducted",
      title: `₹${Math.round(advanceDeducted).toLocaleString("en-IN")} advance deducted from ${d.periodMonth} salary`,
      body: `Net paid: ₹${Math.round(netAmount).toLocaleString("en-IN")}.`,
      link: "/account",
    });
  }

  return NextResponse.json({ ok: true, id: result.id, advanceDeducted, netAmount });
}
