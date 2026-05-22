// Staff-facing expense submission. Distinct from /api/expenses POST in two
// ways:
//   - permission gate is `expense.submit` (broad — every centre staff role)
//     rather than `expense.manage` (admin/accountant only)
//   - paid is forced false; only the accountant flips that later via the
//     existing /api/expenses/[id] PATCH route
//
// A category is picked up either from the request, or — if the submitter
// doesn't know one — we fall back to the "other_misc" platform category.
// The vendor is captured as free text (vendorName) since most coaches
// won't have created Vendor rows. The accountant can later attach a Vendor
// row if they want to consolidate spend per supplier.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { submitExpenseSchema } from "@/lib/schemas/expense-submit";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "expense.submit")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const featureBlock = await blockIfFeatureOff(session, "expenses");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const centreId = scopeCentre(session);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = submitExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Resolve category — explicit if provided, else fall back to "other_misc"
  // (seeded by prisma/seed.ts). If the platform hasn't seeded it, take any
  // active category as a last resort so submission still succeeds.
  let categoryId = parsed.data.categoryId ?? null;
  if (categoryId) {
    const cat = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!cat) return NextResponse.json({ error: "CATEGORY_NOT_FOUND" }, { status: 400 });
  } else {
    const fallback =
      (await prisma.expenseCategory.findUnique({ where: { code: "other_misc" } })) ??
      (await prisma.expenseCategory.findFirst({ where: { active: true } }));
    if (!fallback) {
      return NextResponse.json(
        { error: "NO_DEFAULT_CATEGORY", message: "No expense categories are configured. Ask an admin to add one." },
        { status: 400 },
      );
    }
    categoryId = fallback.id;
  }

  // Embed the vendor name in the description so the accountant sees it at
  // a glance in the expenses list without us minting a Vendor row for every
  // one-off purchase.
  const description = parsed.data.vendorName
    ? `${parsed.data.description} · vendor: ${parsed.data.vendorName}`
    : parsed.data.description;

  const row = await prisma.expense.create({
    data: {
      centreId,
      categoryId,
      vendorId: null,
      amount: parsed.data.amount,
      gstAmount: parsed.data.gstAmount,
      spentAt: new Date(parsed.data.spentAt),
      description,
      invoiceRef: parsed.data.invoiceRef,
      paid: false,
      attachmentUrl: parsed.data.attachmentUrl,
      createdBy: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "expense.submit",
    tableName: "expense",
    rowId: row.id,
    after: { amount: row.amount, hasAttachment: true },
  });

  return NextResponse.json({ ok: true, id: row.id });
}

// GET — list the submissions made by *the current user*. Coaches use this
// to see "what have I submitted this month and what's still unpaid."
// Distinct from /api/expenses GET which requires finance.read (admin only).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "expense.submit")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const rows = await prisma.expense.findMany({
    where: { createdBy: session.userId },
    include: {
      category: { select: { name: true, group: true } },
    },
    orderBy: { spentAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ expenses: rows });
}
