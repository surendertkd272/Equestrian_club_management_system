// Bulk mark several Expense rows as paid. Mirrors /api/invoices/bulk-paid
// but for the staff-submitted expense flow (different model — Expense vs
// Invoice — so a separate endpoint keeps validation clean).
//
// Accountant ticks N due rows, picks a method, hits Mark paid. We update
// each row in a single transaction, audit it, and ping the submitter.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";

const schema = z.object({
  expenseIds: z.array(z.string().min(1)).min(1).max(200),
  method: z.enum(["cash", "upi", "bank", "cheque", "card"]).default("cash"),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "expense.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Load all rows in one query so we can validate cross-centre + paid-state
  // before mutating anything.
  const rows = await prisma.expense.findMany({
    where: { id: { in: parsed.data.expenseIds } },
    select: { id: true, centreId: true, paid: true, amount: true, createdBy: true, method: true },
  });
  const validIds: string[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    // HQ roles have centreId = null, so this comparison used to skip EVERY
    // row for an ADMIN — the bulk action silently did nothing for them.
    if (await centreFence(session, r.centreId)) {
      skipped.push(r.id);
      continue;
    }
    if (r.paid) {
      skipped.push(r.id);
      continue;
    }
    validIds.push(r.id);
  }

  if (validIds.length === 0) {
    return NextResponse.json({ ok: true, marked: 0, skipped });
  }

  const now = new Date();
  await prisma.expense.updateMany({
    where: { id: { in: validIds } },
    data: { paid: true, paidAt: now, method: parsed.data.method },
  });

  // Audit + notify per row — separate writes so notify() failures don't
  // back out the bulk transition.
  for (const r of rows) {
    if (!validIds.includes(r.id)) continue;
    await audit({
      userId: session.userId,
      action: "expense.bulk_paid",
      tableName: "expense",
      rowId: r.id,
      before: { paid: false },
      after: { paid: true, method: parsed.data.method },
    });
    if (r.createdBy && r.createdBy !== session.userId) {
      await notify({
        userId: r.createdBy,
        centreId: r.centreId,
        type: "expense.paid",
        title: "Your invoice was reimbursed",
        body: `₹${Math.round(r.amount).toLocaleString("en-IN")} marked paid (${parsed.data.method}).`,
        link: "/expenses/submit",
      });
    }
  }

  return NextResponse.json({ ok: true, marked: validIds.length, skipped });
}
