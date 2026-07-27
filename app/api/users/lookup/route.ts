import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isRole } from "@/lib/roles";
import { orgOfHqUser } from "@/lib/authz-centre";

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

  // This is a STAFF picker. Family accounts have no business enumerating the
  // people who work at a club, and they were the ones it leaked to: PARENT
  // carries centreId = null, so the old `role !== "SUPER_ADMIN" && centreId`
  // conjunct was false and NO filter was applied — a parent received the same
  // cross-organisation staff directory as a super admin, names and roles and
  // ids, for every tenant on the platform.
  if (session.role === "PARENT" || session.role === "RIDER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const where: Record<string, unknown> = { status: "active" };
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (isHQ) {
    // HQ picks across their own organisation's centres — not across tenants.
    const org = await orgOfHqUser(session.userId);
    if (!org) return NextResponse.json({ error: "FORBIDDEN_NO_ORG" }, { status: 403 });
    where.centre = { orgId: org };
  } else if (session.centreId) {
    where.centreId = session.centreId;
  } else {
    // Any other centre-less role: fail closed rather than return everything.
    return NextResponse.json({ error: "FORBIDDEN_NO_CENTRE" }, { status: 403 });
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
