import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { createExpenseSchema } from "@/lib/schemas/finance";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff, getOrgIdForSession } from "@/lib/features-gate";

// GET — list expenses with optional date range. Used by the finance
// dashboard and the expenses page.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "finance.read")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });
  const centreId = scopeCentre(session);
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const where: Prisma.ExpenseWhereInput = { ...tenantWhere(centreId, orgId) };
  if (from || to) {
    where.spentAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  const rows = await prisma.expense.findMany({
    where,
    include: {
      category: { select: { name: true, group: true } },
      vendor: { select: { name: true } },
    },
    orderBy: { spentAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ expenses: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "expense.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const featureBlock = await blockIfFeatureOff(session, "expenses");
  if (featureBlock) return featureBlock;
  const body = await req.json().catch(() => null);
  const parsed = createExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const centreId = scopeCentre(session);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  // Verify the category + vendor belong to scope-appropriate places.
  const cat = await prisma.expenseCategory.findUnique({ where: { id: parsed.data.categoryId } });
  if (!cat) return NextResponse.json({ error: "CATEGORY_NOT_FOUND" }, { status: 400 });
  if (parsed.data.vendorId) {
    const v = await prisma.vendor.findUnique({ where: { id: parsed.data.vendorId } });
    if (!v || v.centreId !== centreId) return NextResponse.json({ error: "INVALID_VENDOR" }, { status: 400 });
  }

  const row = await prisma.expense.create({
    data: {
      centreId,
      categoryId: parsed.data.categoryId,
      vendorId: parsed.data.vendorId ?? null,
      amount: parsed.data.amount,
      gstAmount: parsed.data.gstAmount,
      qty: parsed.data.qty ?? null,
      unitRate: parsed.data.unitRate ?? null,
      spentAt: new Date(parsed.data.spentAt),
      description: parsed.data.description,
      invoiceRef: parsed.data.invoiceRef,
      paid: parsed.data.paid,
      paidAt: parsed.data.paid && parsed.data.paidAt ? new Date(parsed.data.paidAt) : null,
      method: parsed.data.method,
      attachmentUrl: parsed.data.attachmentUrl,
      createdBy: session.userId,
    },
  });
  await audit({
    userId: session.userId,
    action: "expense.create",
    tableName: "expense",
    rowId: row.id,
    after: { amount: row.amount, categoryId: row.categoryId },
  });
  return NextResponse.json({ id: row.id });
}
