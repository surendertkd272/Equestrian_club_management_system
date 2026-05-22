// HQ-level expense ledger. Only SUPER_ADMIN can touch this — these are
// payments scoped to the whole organisation (umbrella insurance, software
// subscriptions, bulk vaccine orders, etc), with optional per-club tagging
// for cost-allocation reports.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createHqExpenseSchema } from "@/lib/schemas/hq-expense";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

async function requireSuperAdmin() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (session.role !== "SUPER_ADMIN") {
    return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
  // orgId isn't on the JWT — resolve from the user row. SUPER_ADMINs use
  // User.orgId directly; defensive fallback via centre.orgId for legacy rows.
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { orgId: true, centre: { select: { orgId: true } } },
  });
  const orgId = user?.orgId ?? user?.centre?.orgId ?? null;
  if (!orgId) {
    return { error: NextResponse.json({ error: "NO_ORG_CONTEXT" }, { status: 400 }) };
  }
  return { session, orgId };
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if ("error" in guard) return guard.error;
  const { orgId } = guard;

  const rows = await prisma.hqExpense.findMany({
    where: { orgId },
    include: { category: { select: { name: true, group: true } } },
    orderBy: { spentAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ expenses: rows });
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if ("error" in guard) return guard.error;
  const { session, orgId } = guard;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createHqExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Category — optional, but if provided must exist (and is platform-wide).
  if (parsed.data.categoryId) {
    const cat = await prisma.expenseCategory.findUnique({ where: { id: parsed.data.categoryId } });
    if (!cat) return NextResponse.json({ error: "CATEGORY_NOT_FOUND" }, { status: 400 });
  }

  // Validate that any tagged centres belong to this org — block a hostile
  // payload from cross-tagging another org's centres.
  if (parsed.data.taggedCentreIds.length > 0) {
    const centres = await prisma.centre.findMany({
      where: { id: { in: parsed.data.taggedCentreIds }, orgId },
      select: { id: true },
    });
    if (centres.length !== new Set(parsed.data.taggedCentreIds).size) {
      return NextResponse.json({ error: "INVALID_CENTRE_TAG" }, { status: 400 });
    }
  }

  const row = await prisma.hqExpense.create({
    data: {
      orgId,
      categoryId: parsed.data.categoryId ?? null,
      amount: parsed.data.amount,
      gstAmount: parsed.data.gstAmount,
      spentAt: new Date(parsed.data.spentAt),
      description: parsed.data.description,
      vendorName: parsed.data.vendorName ?? null,
      invoiceRef: parsed.data.invoiceRef ?? null,
      taggedCentreIdsCsv: parsed.data.taggedCentreIds.length > 0 ? parsed.data.taggedCentreIds.join(",") : null,
      paid: parsed.data.paid,
      paidAt: parsed.data.paid && parsed.data.paidAt ? new Date(parsed.data.paidAt) : null,
      method: parsed.data.method ?? null,
      attachmentUrl: parsed.data.attachmentUrl,
      createdBy: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "hq_expense.create",
    tableName: "hqExpense",
    rowId: row.id,
    after: { amount: row.amount, taggedCentres: parsed.data.taggedCentreIds.length },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
