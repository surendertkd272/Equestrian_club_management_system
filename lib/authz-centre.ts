// The centre fence for a row a caller is about to act on.
//
// Written by hand in ~60 routes as
//     if (session.role !== "SUPER_ADMIN" && row.centreId !== session.centreId) 403
// which is wrong in both directions. HQ roles (SUPER_ADMIN, ADMIN) carry
// centreId = null, so for ADMIN the comparison is ALWAYS true — they were
// locked out of every centre's rows across the product — and for whichever HQ
// role the check exempts, it fences nothing at all, leaving one organisation's
// admin free to act on another organisation's data.
//
// Deliberately a LEAF module: it imports the Prisma client and a type, nothing
// else. The obvious home was lib/authz-org.ts, but that pulls in
// lib/features-gate → react/next-navigation/auth/tenant-context, and adding
// that graph to sixty route files slowed module loading enough to starve
// vitest workers and make the suite flaky. A fence this widely used has to be
// cheap to import.

import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/roles";

type FenceSession = { role: Role | string; centreId: string | null; userId: string };

/** Organisation a centre belongs to. */
async function orgOfCentre(centreId: string): Promise<string | null> {
  const c = await prisma.centre.findUnique({ where: { id: centreId }, select: { orgId: true } });
  return c?.orgId ?? null;
}

/**
 * Organisation an HQ caller belongs to. Mirrors resolveOrgIdForSession's HQ
 * branch in lib/features-gate.ts: prefer the explicit User.orgId, and fall back
 * to the first centre's org for rows that predate that column.
 */
async function orgOfHqUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  if (user?.orgId) return user.orgId;
  const first = await prisma.centre.findFirst({ select: { orgId: true } });
  return first?.orgId ?? null;
}

/**
 * Decide whether `session` may act on a row belonging to `rowCentreId`.
 * Returns the error code to hand back to the caller, or null to proceed.
 */
export async function centreFence(
  session: FenceSession,
  rowCentreId: string | null,
): Promise<"FORBIDDEN_CROSS_ORG" | "FORBIDDEN_CROSS_CENTRE" | null> {
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (isHQ) {
    // An HQ-owned row with no centre of its own is theirs to touch.
    if (!rowCentreId) return null;
    const [callerOrg, rowOrg] = await Promise.all([orgOfHqUser(session.userId), orgOfCentre(rowCentreId)]);
    return !callerOrg || callerOrg !== rowOrg ? "FORBIDDEN_CROSS_ORG" : null;
  }
  return rowCentreId !== session.centreId ? "FORBIDDEN_CROSS_CENTRE" : null;
}
