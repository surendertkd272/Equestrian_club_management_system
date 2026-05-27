// Salary advance ledger. The accountant (or HQ admin) issues an advance
// to a staff member; the same role(s) later record repayments deducted
// from payroll. Status flips automatically based on sum(repayments).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { createAdvanceSchema } from "@/lib/schemas/advance";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";

function canManageAdvances(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManageAdvances(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const centreId = scopeCentre(session);
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");

  const advances = await prisma.employeeAdvance.findMany({
    where: {
      ...centreWhere(centreId),
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    include: {
      user: { select: { id: true, name: true, role: true } },
      repayments: { orderBy: { deductedAt: "desc" } },
    },
    orderBy: [{ status: "asc" }, { givenAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ advances });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManageAdvances(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createAdvanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Recipient must be at the caller's centre (or any centre for HQ tier).
  const recipient = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, name: true, centreId: true, status: true },
  });
  if (!recipient) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  if (recipient.status !== "active") {
    return NextResponse.json({ error: "USER_NOT_ACTIVE" }, { status: 400 });
  }
  if (!recipient.centreId) {
    return NextResponse.json({ error: "USER_HAS_NO_CENTRE" }, { status: 400 });
  }
  // ACCOUNTANT can only issue to their own centre's staff; HQ-tier can
  // issue to any centre.
  if (
    session.role === "ACCOUNTANT" &&
    recipient.centreId !== session.centreId
  ) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const advance = await prisma.employeeAdvance.create({
    data: {
      userId: recipient.id,
      centreId: recipient.centreId,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      notes: parsed.data.notes ?? null,
      givenByUserId: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "advance.create",
    tableName: "employeeAdvance",
    rowId: advance.id,
    after: { recipient: recipient.name, amount: advance.amount, reason: advance.reason },
  });

  await notify({
    userId: recipient.id,
    centreId: recipient.centreId,
    type: "advance.issued",
    title: "Salary advance recorded",
    body: `An advance of ₹${Math.round(advance.amount).toLocaleString("en-IN")} (${advance.reason}) has been logged against your account. It will be deducted from upcoming salary.`,
    link: "/account",
  });

  return NextResponse.json({ ok: true, id: advance.id });
}
