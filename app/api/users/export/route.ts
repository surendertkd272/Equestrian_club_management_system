import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isRole } from "@/lib/roles";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { USER_STATUSES } from "@/lib/schemas/user-admin";
import { toCsv, csvResponse } from "@/lib/csv";
import { audit } from "@/lib/audit";
import { roleLabel } from "@/lib/labels";

// CSV of the user roster — the same rows /users shows, as a file.
//
// Mirrors that page's filter semantics exactly (q / role / centreId / status,
// including ?centreId=null meaning "HQ-tier staff with no centre" and the
// topbar cookie as the fallback), so what you export is what you were looking
// at. A filtered view that exports something different is worse than no export.
//
// HQ only, because the page is. Note the gate is on the ROUTE, not per row:
// a bulk export must never be waved through by a permission that was written
// for reading one record — that is how a cross-club leak happens.
//
// Never includes a password or a hash. Credentials live on
// /users/credentials, which is separately gated and separately audited.

// Excel gets unhappy well before this, and an export this large means someone
// wants the database, not a spreadsheet.
const MAX_ROWS = 10000;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const where: Record<string, unknown> = {};

  const role = sp.get("role");
  if (role && isRole(role)) where.role = role;

  const centreId = sp.get("centreId");
  if (centreId === "null") {
    where.centreId = null;
  } else if (centreId) {
    where.centreId = centreId;
  } else {
    const scoped = scopeCentre(session);
    if (scoped) where.centreId = scoped;
  }

  const status = sp.get("status");
  if (status && (USER_STATUSES as readonly string[]).includes(status)) where.status = status;

  const q = sp.get("q")?.trim();
  if (q) where.OR = [{ name: { contains: q } }, { email: { contains: q } }];

  // Org fence, AND-combined so it survives the q-OR above. Without the AND a
  // search term would widen the result past the caller's own tenant.
  where.AND = [{ OR: [{ orgId }, { centre: { orgId } }] }];

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        mustChangePassword: true,
        issuedPasswordEnc: true,
        createdAt: true,
        centre: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }, { id: "asc" }],
      take: MAX_ROWS,
    }),
  ]);

  const csv = toCsv(
    [
      "ID",
      "Name",
      "Email (username)",
      "Phone",
      "Role",
      "Role code",
      "Centre",
      "Status",
      "Email verified",
      "Must change password",
      // Not the password — just whether one is waiting on the handover sheet,
      // so you can tell "never collected their login" from "signed in and set
      // their own" without opening that page.
      "Unused password on sheet",
      "Created",
    ],
    rows.map((u) => [
      u.id,
      u.name,
      u.email,
      u.phone ?? "",
      roleLabel(u.role),
      u.role,
      u.centre?.name ?? "HQ (no centre)",
      u.status,
      u.emailVerifiedAt ? "yes" : "no",
      u.mustChangePassword ? "yes" : "no",
      u.issuedPasswordEnc ? "yes" : "no",
      u.createdAt.toISOString().slice(0, 10),
    ]),
  );

  // Exporting the roster is bulk PII leaving the system. Log who did it and
  // how much, so the act is answerable later.
  await audit({
    userId: session.userId,
    action: "user.export",
    tableName: "user",
    rowId: orgId,
    after: { returned: rows.length, total, filters: { q, role, centreId, status } },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`users-${stamp}.csv`, csv, {
    total,
    returned: rows.length,
    truncated: total > rows.length,
  });
}
