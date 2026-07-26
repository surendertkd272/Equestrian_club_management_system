// Void a payroll run recorded in error — wrong month, wrong person, wrong
// amount, or run twice. Until now a salary payment could not be undone at all:
// one mis-click permanently overstated cost and the only remedy was a database
// edit.
//
// Soft, like every other reversal here. The row stays with who voided it and
// why, so the payslip history and the audit trail survive; it is excluded from
// totals and from the Tally export, and any advance it recovered is released
// back to the employee as a compensating (negative) repayment rather than by
// deleting the original — so the advance ledger shows both halves.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { notify } from "@/lib/notify";

// Same set that may record a salary (app/api/salary/route.ts).
function canManagePayroll(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

const schema = z.object({ reason: z.string().min(3).max(300) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManagePayroll(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: "A reason is required to void a payroll run.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const row = await prisma.salaryPayment.findUnique({
    where: { id: params.id },
    include: { repayments: { include: { advance: { include: { repayments: true } } } }, user: { select: { name: true } } },
  });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN" && row.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (row.voidedAt) {
    return NextResponse.json({ error: "ALREADY_VOID", voidedAt: row.voidedAt }, { status: 409 });
  }

  let released = 0;
  await prisma.$transaction(async (tx) => {
    await tx.salaryPayment.update({
      where: { id: row.id },
      data: { voidedAt: new Date(), voidedByUserId: session.userId, voidReason: parsed.data.reason },
    });

    // Release each advance this run recovered, with a compensating negative
    // repayment so the advance ledger keeps both entries, then recompute the
    // advance's status from the new balance.
    for (const rep of row.repayments) {
      if (rep.amount <= 0) continue; // already a release
      await tx.advanceRepayment.create({
        data: {
          advanceId: rep.advanceId,
          amount: -rep.amount,
          recordedByUserId: session.userId,
          notes: `Released — ${row.periodMonth} payroll voided`,
        },
      });
      released += rep.amount;
      const netRepaid = rep.advance.repayments.reduce((t, r) => t + r.amount, 0) - rep.amount;
      const status =
        netRepaid >= rep.advance.amount - 0.01 ? "repaid" : netRepaid > 0.01 ? "partially_repaid" : "outstanding";
      await tx.employeeAdvance.update({ where: { id: rep.advanceId }, data: { status } });
    }
  });

  await audit({
    userId: session.userId,
    action: "salary.void",
    tableName: "salaryPayment",
    rowId: row.id,
    before: {
      periodMonth: row.periodMonth,
      gross: row.grossAmount,
      net: row.netAmount,
      advanceDeducted: row.advanceDeducted,
      paidAt: row.paidAt,
    },
    after: { voided: true, reason: parsed.data.reason, advanceReleased: released },
  });

  // The employee was told the advance was recovered; tell them it was released.
  if (released > 0.01) {
    await notify({
      userId: row.userId,
      centreId: row.centreId,
      type: "salary.voided",
      title: `${row.periodMonth} payroll entry was corrected`,
      body: `₹${Math.round(released).toLocaleString("en-IN")} of advance recovery has been released back to your balance. Reason: ${parsed.data.reason}`,
      link: `/my-documents`,
    });
  }

  return NextResponse.json({ ok: true, voided: true, advanceReleased: released });
}
