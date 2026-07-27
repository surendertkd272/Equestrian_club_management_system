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
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
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
  // HQ roles (SUPER_ADMIN, ADMIN) have centreId = null, so a bare
  // `row.centreId !== session.centreId` both LOCKS OUT the admin (every
  // comparison is true) and, where it exempts them, fences nothing at all.
  // Bind them to their own organisation instead.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (isHQ) {
    const [callerOrg, rowOrg] = await Promise.all([
      getOrgIdForSession(session),
      getOrgIdForCentre(row.centreId),
    ]);
    if (!callerOrg || callerOrg !== rowOrg) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
  } else if (row.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (row.voidedAt) {
    return NextResponse.json({ error: "ALREADY_VOID", voidedAt: row.voidedAt }, { status: 409 });
  }

  let released = 0;
  let raced = false;
  await prisma.$transaction(async (tx) => {
    // Re-check under the row lock. Reading `row.voidedAt` before the
    // transaction let two concurrent voids both pass and both release the same
    // advance, so an employee's balance was credited twice.
    await tx.$queryRaw`SELECT id FROM "SalaryPayment" WHERE id = ${row.id} FOR UPDATE`;
    const fresh = await tx.salaryPayment.findUnique({
      where: { id: row.id },
      select: { voidedAt: true },
    });
    if (!fresh || fresh.voidedAt) {
      raced = true;
      return;
    }
    // Step the voided row out of the (userId, periodMonth, voidSeq) unique so
    // the corrected run can be recorded against the same month.
    const prior = await tx.salaryPayment.aggregate({
      where: { userId: row.userId, periodMonth: row.periodMonth },
      _max: { voidSeq: true },
    });
    await tx.salaryPayment.update({
      where: { id: row.id },
      data: {
        voidedAt: new Date(),
        voidedByUserId: session.userId,
        voidReason: parsed.data.reason,
        voidSeq: (prior._max.voidSeq ?? 0) + 1,
      },
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

  if (raced) {
    return NextResponse.json({ error: "ALREADY_VOID" }, { status: 409 });
  }

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

  return NextResponse.json({
    ok: true,
    voided: true,
    advanceReleased: released,
    // AdvanceRepayment.salaryPaymentId only exists on runs recorded after the
    // reversibility migration. Voiding an older run cannot know which advance
    // it recovered, so say so rather than silently leaving the employee's
    // balance overstated.
    ...(row.advanceDeducted > 0.01 && released < row.advanceDeducted - 0.01
      ? {
          advanceNotReleased: row.advanceDeducted - released,
          warning:
            `This run recovered ₹${Math.round(row.advanceDeducted - released).toLocaleString("en-IN")} of advance that isn't linked to it ` +
            `(it predates advance linking). Release it manually on the employee's advance record.`,
        }
      : {}),
  });
}
