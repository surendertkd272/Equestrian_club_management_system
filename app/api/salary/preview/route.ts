// Live salary computation for a staff member + month, used by the recorder
// form to show gross / attendance deduction / advance before saving.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { salaryPreview } from "@/lib/payroll";

function canView(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canView(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const periodMonth = url.searchParams.get("month");
  if (!userId || !periodMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonth)) {
    return NextResponse.json({ error: "BAD_PARAMS" }, { status: 400 });
  }

  const staff = await prisma.user.findUnique({ where: { id: userId }, select: { centreId: true } });
  if (!staff || !staff.centreId) return NextResponse.json({ error: "STAFF_NOT_FOUND" }, { status: 404 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== staff.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const preview = await salaryPreview(userId, staff.centreId, periodMonth);
  return NextResponse.json(preview);
}
