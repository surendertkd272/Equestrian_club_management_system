// PATCH /api/salary/[id] — currently supports flipping paidAt from null
// to now (the 'mark paid' action on the salary list). Future updates
// to other fields can extend the schema.
//
// Permission: ACCOUNTANT + HQ admins. Centre-scope check enforces
// accountants can only mark their own centre's salaries.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { z } from "zod";

function canManagePayroll(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

const patchSchema = z.object({
  // The only action exposed today. Modelled as an explicit verb so future
  // operations (mark-unpaid, change-method) stay separate from this one.
  action: z.literal("mark_paid"),
  method: z.enum(["cash", "bank", "upi", "cheque"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManagePayroll(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await prisma.salaryPayment.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== row.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // A voided run is not payable. The list already hides the button, but the
  // API had no guard, so a stale tab or a direct call could mark a cancelled
  // payroll entry as paid and put the cost back on the books.
  if (row.voidedAt) {
    return NextResponse.json(
      { error: "VOIDED", voidedAt: row.voidedAt, message: "This payroll run was voided. Record a fresh one." },
      { status: 409 },
    );
  }

  if (row.paidAt) {
    // Idempotent — return 200 with alreadyPaid:true rather than 409 so the
    // UI can no-op gracefully if the user double-clicks.
    return NextResponse.json({ ok: true, alreadyPaid: true, paidAt: row.paidAt });
  }

  const updated = await prisma.salaryPayment.update({
    where: { id: row.id },
    data: {
      paidAt: new Date(),
      ...(parsed.data.method ? { method: parsed.data.method } : {}),
    },
  });
  await audit({
    userId: session.userId,
    action: "salary.mark_paid",
    tableName: "salaryPayment",
    rowId: row.id,
    before: { paidAt: null, method: row.method },
    after: { paidAt: updated.paidAt, method: updated.method },
  });
  return NextResponse.json({ ok: true, paidAt: updated.paidAt });
}
