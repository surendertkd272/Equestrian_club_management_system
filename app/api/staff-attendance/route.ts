import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, centreWhere } from "@/lib/tenancy";

// GET /api/staff-attendance?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=... — list rows in a window.
// Manager/head-coach/etc. see their centre; super-admin can pass ?centre=<id>.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.attendance")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const userId = url.searchParams.get("userId");
  const requestedCentre = url.searchParams.get("centre");

  const scopedCentre = scopeCentre(session, requestedCentre);

  const where: Record<string, unknown> = { ...centreWhere(scopedCentre) };
  if (userId) where.userId = userId;
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.gte = new Date(`${from}T00:00:00.000Z`);
    if (to) range.lte = new Date(`${to}T23:59:59.999Z`);
    where.date = range;
  }

  const rows = await prisma.staffAttendance.findMany({
    where,
    orderBy: [{ date: "desc" }, { user: { name: "asc" } }],
    include: { user: { select: { id: true, name: true, role: true } } },
    take: 500,
  });

  return NextResponse.json({ rows });
}
