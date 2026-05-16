import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isRole } from "@/lib/roles";

// Slim picker endpoint used by panels that need to add another user (judges,
// support staff). Scoped to the caller's centre so a Coach picking grooms
// doesn't leak the SUPER_ADMIN search-everywhere capability. Accepts a
// comma-separated `role` filter — useful when a picker wants several roles.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const url = new URL(req.url);
  const rolesParam = url.searchParams.get("role")?.split(",").map((r) => r.trim()).filter(Boolean) ?? [];
  const roles = rolesParam.filter((r) => isRole(r));
  const q = url.searchParams.get("q")?.trim();

  const where: Record<string, unknown> = { status: "active" };
  // SUPER_ADMIN can pick across orgs; everyone else is centre-scoped.
  if (session.role !== "SUPER_ADMIN" && session.centreId) {
    where.centreId = session.centreId;
  }
  if (roles.length > 0) where.role = { in: roles };
  if (q) where.OR = [{ name: { contains: q } }, { email: { contains: q } }];

  const users = await prisma.user.findMany({
    where,
    orderBy: { name: "asc" },
    take: 50,
    select: { id: true, name: true, role: true },
  });
  return NextResponse.json({ users });
}
