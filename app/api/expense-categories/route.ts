import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createExpenseCategorySchema } from "@/lib/schemas/finance";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// GET — list categories (platform-wide chart of accounts).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const cats = await prisma.expenseCategory.findMany({
    where: { active: true },
    orderBy: [{ group: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ categories: cats });
}

// POST — HQ adds a category. Categories live platform-wide so HQ rollups
// across centres aggregate on consistent codes.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createExpenseCategorySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  try {
    const row = await prisma.expenseCategory.create({ data: parsed.data });
    await audit({
      userId: session.userId,
      action: "expense_category.create",
      tableName: "expenseCategory",
      rowId: row.id,
    });
    return NextResponse.json({ id: row.id });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "DUPLICATE_CODE" }, { status: 409 });
    throw e;
  }
}
