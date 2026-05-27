// Record a deduction against an outstanding advance. Sum across all
// repayments cannot exceed the original amount. When the total hits the
// principal, advance.status flips to "repaid"; partial amounts flip it
// to "partially_repaid".

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { recordRepaymentSchema } from "@/lib/schemas/advance";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";

function canManageAdvances(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManageAdvances(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const advance = await prisma.employeeAdvance.findUnique({
    where: { id: params.id },
    include: { repayments: { select: { amount: true } } },
  });
  if (!advance) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (advance.status === "repaid" || advance.status === "written_off") {
    return NextResponse.json({ error: "ALREADY_CLOSED", status: advance.status }, { status: 409 });
  }
  // ACCOUNTANT scoped to their own centre.
  if (
    session.role === "ACCOUNTANT" &&
    advance.centreId !== session.centreId
  ) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = recordRepaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const alreadyRepaid = advance.repayments.reduce((s, r) => s + r.amount, 0);
  const remaining = advance.amount - alreadyRepaid;
  if (parsed.data.amount > remaining + 0.01) {
    return NextResponse.json(
      { error: "OVERPAYMENT", remaining },
      { status: 400 },
    );
  }

  const repayment = await prisma.advanceRepayment.create({
    data: {
      advanceId: advance.id,
      amount: parsed.data.amount,
      notes: parsed.data.notes ?? null,
      recordedByUserId: session.userId,
    },
  });

  // Flip status based on the new total. Floor tolerance of 0.01 to absorb
  // floating-point rounding from currency math.
  const newTotal = alreadyRepaid + parsed.data.amount;
  const newStatus = newTotal >= advance.amount - 0.01 ? "repaid" : "partially_repaid";
  await prisma.employeeAdvance.update({
    where: { id: advance.id },
    data: { status: newStatus },
  });

  await audit({
    userId: session.userId,
    action: "advance.repay",
    tableName: "advanceRepayment",
    rowId: repayment.id,
    after: { advanceId: advance.id, amount: parsed.data.amount, newStatus },
  });

  await notify({
    userId: advance.userId,
    centreId: advance.centreId,
    type: "advance.repay",
    title: `₹${Math.round(parsed.data.amount).toLocaleString("en-IN")} deducted from salary advance`,
    body: newStatus === "repaid"
      ? "Your advance balance is now fully cleared."
      : `Outstanding balance: ₹${Math.round(advance.amount - newTotal).toLocaleString("en-IN")}.`,
    link: "/account",
  });

  return NextResponse.json({ ok: true, status: newStatus });
}
