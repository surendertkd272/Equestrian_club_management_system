// Set or raise a staff member's salary. A raise is a new effective-dated row
// (history is never edited in place). Editable by SUPER_ADMIN / ADMIN /
// ACCOUNTANT.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { salaryStructureSchema } from "@/lib/schemas/payroll";

// Only SUPER_ADMIN defines staff salaries.
function canEdit(role: string): boolean {
  return role === "SUPER_ADMIN";
}

function dateOnly(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canEdit(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = salaryStructureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const staff = await prisma.user.findUnique({
    where: { id: d.userId },
    select: { id: true, centreId: true },
  });
  if (!staff || !staff.centreId) {
    return NextResponse.json({ error: "STAFF_NOT_FOUND" }, { status: 404 });
  }
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== staff.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const row = await prisma.salaryStructure.create({
    data: {
      userId: d.userId,
      centreId: staff.centreId,
      monthlySalary: d.monthlySalary,
      effectiveFrom: dateOnly(d.effectiveFrom),
      note: d.note ?? null,
      createdByUserId: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "salary.structure_set",
    tableName: "salaryStructure",
    rowId: row.id,
    after: { userId: d.userId, monthlySalary: d.monthlySalary, effectiveFrom: d.effectiveFrom },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
