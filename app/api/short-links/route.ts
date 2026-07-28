// Create + list short-links. Generation gated to admins (anyone who can
// create rider records — broad enough for the WhatsApp invite use case).
// The redirect surface at /r/[code] is public and rate-limited.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentreForRoute, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import {
  createShortLinkSchema,
  SHORT_LINK_KINDS,
  generateShortCode,
} from "@/lib/schemas/short-link";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// Roles allowed to mint and view short-links. Widened from the original
// admin-only set to include Head Coach + Stable Manager, since mid-sized
// clubs lean on senior staff to onboard new riders and trigger ad-hoc
// form sends. The redemption surface at /r/[code] remains fully public.
function canManageLinks(role: string): boolean {
  return role === "SUPER_ADMIN"
    || role === "CENTRE_MANAGER"
    || role === "HEAD_COACH"
    || role === "STABLE_MANAGER";
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManageLinks(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });
  const scoped = scopeCentreForRoute(session);
  if (scoped.error) return scoped.error;
  const centreId = scoped.centreId;
  const rows = await prisma.shortLink.findMany({
    where: tenantWhere(centreId, orgId),
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ links: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManageLinks(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const scoped = scopeCentreForRoute(session);
  if (scoped.error) return scoped.error;
  const centreId = scoped.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = createShortLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Resolve target path. Known kinds use the catalog mapping; vet_visit_horse
  // + generic accept a custom path.
  let targetPath: string = SHORT_LINK_KINDS[parsed.data.kind].targetPath;
  if (!targetPath) {
    if (!parsed.data.targetPath) {
      return NextResponse.json({ error: "TARGET_PATH_REQUIRED" }, { status: 400 });
    }
    targetPath = parsed.data.targetPath;
  }

  // Generate a unique code. In practice 8 chars of base32 = 32^8 = ~10^12
  // possibilities, so collisions are vanishingly rare; we retry up to 5x
  // anyway for safety on a very small DB shard.
  let code = "";
  for (let i = 0; i < 5; i++) {
    code = generateShortCode(8);
    const existing = await prisma.shortLink.findUnique({ where: { code } });
    if (!existing) break;
    code = "";
  }
  if (!code) return NextResponse.json({ error: "CODE_GENERATION_FAILED" }, { status: 500 });

  const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86400000);

  const row = await prisma.shortLink.create({
    data: {
      code,
      centreId,
      kind: parsed.data.kind,
      targetPath,
      // jsonb column — pass the object directly; absent → Prisma.DbNull.
      paramsJson: parsed.data.params ? parsed.data.params : Prisma.DbNull,
      label: parsed.data.label ?? SHORT_LINK_KINDS[parsed.data.kind].label,
      expiresAt,
      singleUse: parsed.data.singleUse,
      createdByUserId: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "short_link.create",
    tableName: "shortLink",
    rowId: row.id,
    after: { kind: row.kind, code: row.code },
  });

  return NextResponse.json({ ok: true, link: row });
}
