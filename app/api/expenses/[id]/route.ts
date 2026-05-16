import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateExpenseSchema } from "@/lib/schemas/finance";
import { audit } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "expense.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = updateExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.expense.findUnique({ where: { id: params.id } });
  if (!before) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && before.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const updated = await prisma.expense.update({
    where: { id: before.id },
    data: {
      ...(parsed.data.categoryId !== undefined ? { categoryId: parsed.data.categoryId } : {}),
      ...(parsed.data.vendorId !== undefined ? { vendorId: parsed.data.vendorId ?? null } : {}),
      ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
      ...(parsed.data.gstAmount !== undefined ? { gstAmount: parsed.data.gstAmount } : {}),
      ...(parsed.data.spentAt !== undefined ? { spentAt: new Date(parsed.data.spentAt) } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.invoiceRef !== undefined ? { invoiceRef: parsed.data.invoiceRef ?? null } : {}),
      ...(parsed.data.paid !== undefined ? { paid: parsed.data.paid } : {}),
      ...(parsed.data.paidAt !== undefined
        ? { paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : null }
        : {}),
      ...(parsed.data.method !== undefined ? { method: parsed.data.method } : {}),
      ...(parsed.data.attachmentUrl !== undefined ? { attachmentUrl: parsed.data.attachmentUrl ?? null } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "expense.update",
    tableName: "expense",
    rowId: updated.id,
    before: { amount: before.amount, paid: before.paid },
    after: { amount: updated.amount, paid: updated.paid },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "expense.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const row = await prisma.expense.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && row.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  await prisma.expense.delete({ where: { id: row.id } });
  await audit({ userId: session.userId, action: "expense.delete", tableName: "expense", rowId: row.id });
  return NextResponse.json({ ok: true });
}
