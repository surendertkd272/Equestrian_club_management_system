import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  clearOwnerSessionCookie,
  getOwnerSession,
} from "@/lib/owner-auth";
import { setSessionCookie, signSession } from "@/lib/auth";
import { auditOwner } from "@/lib/owner-audit";
import { isRole } from "@/lib/roles";

const schema = z.object({ userId: z.string().min(1) });

// POST /api/owner/tenants/[id]/impersonate — sign in as a tenant user.
//
// Only OWNER_ADMIN can do this — impersonation is sensitive (every action the
// owner takes shows up as the impersonated user's audit trail). We mint a
// tenant session with `impersonatedBy` set, clear the owner cookie, and
// return a redirect URL appropriate to the target's role. The owner returns
// to /owner via POST /api/owner/impersonate/stop, which re-mints their owner
// session without requiring re-login.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "OWNER_ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN", required: "OWNER_ADMIN" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Target must belong to this tenant — either via centreId (centre-scoped
  // user) or via SUPER_ADMIN-of-this-org (centreId=null, but their org is
  // implicitly the one with the matching centres).
  const tenant = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: { id: true, centres: { select: { id: true } } },
  });
  if (!tenant) return NextResponse.json({ error: "TENANT_NOT_FOUND" }, { status: 404 });
  const centreIds = tenant.centres.map((c) => c.id);

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, name: true, email: true, role: true, centreId: true, orgId: true, status: true },
  });
  if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  if (target.status !== "active") {
    return NextResponse.json({ error: "USER_INACTIVE" }, { status: 409 });
  }
  if (!isRole(target.role)) {
    return NextResponse.json({ error: "BAD_ROLE" }, { status: 500 });
  }
  // Membership rules:
  // 1. Centre-scoped user → must belong to a centre under this org.
  // 2. SUPER_ADMIN with orgId set → that orgId must match the target tenant.
  // 3. SUPER_ADMIN with orgId still NULL (legacy rows pre-backfill) →
  //    fall back to "any org with centres" to preserve current behaviour
  //    until the backfill script runs. New SUPER_ADMINs always get orgId.
  const belongs =
    (target.centreId !== null && centreIds.includes(target.centreId)) ||
    (target.role === "SUPER_ADMIN" && target.orgId === tenant.id) ||
    (target.role === "SUPER_ADMIN" && target.orgId === null && centreIds.length > 0);
  if (!belongs) {
    return NextResponse.json({ error: "USER_NOT_IN_TENANT" }, { status: 403 });
  }

  // Cap impersonation at 30 min independent of JWT_ACCESS_TTL_MIN. The
  // session resolver enforces this via `impersonationExpiresAt` — once it
  // lapses, the impersonated session is dead and the owner must restart
  // from /owner/tenants. This shrinks the blast radius of a forgotten
  // impersonation tab and forces a fresh audit trail entry per session.
  const IMPERSONATION_TTL_MIN = 30;
  const expiresAt = Date.now() + IMPERSONATION_TTL_MIN * 60_000;
  const token = await signSession({
    userId: target.id,
    role: target.role,
    centreId: target.centreId ?? null,
    name: target.name,
    impersonatedBy: session.ownerId,
    impersonationExpiresAt: expiresAt,
  });
  await setSessionCookie(token);
  // Clear the owner cookie so the impersonated session is unambiguous — the
  // owner can't accidentally hit both portals in two tabs and confuse audit.
  await clearOwnerSessionCookie();

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.impersonation_started",
    orgId: tenant.id,
    after: { targetUserId: target.id, email: target.email, role: target.role, expiresAt: new Date(expiresAt).toISOString() },
  });

  const redirect =
    target.role === "PARENT" ? "/parent"
    : target.role === "RIDER" ? "/student"
    : "/dashboard";
  return NextResponse.json({ ok: true, redirect, target: { id: target.id, role: target.role, name: target.name } });
}
