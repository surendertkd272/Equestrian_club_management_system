import { prisma } from "@/lib/prisma";
import { getOrgIdForSession } from "@/lib/features-gate";
import type { SessionPayload } from "@/lib/auth";

// The User and Centre tables are RLS-permissive (identity tables), so DB-level
// org isolation does NOT cover writes to them — the app layer must enforce it.

// Resolve a user's org: explicit orgId, else via their centre, else (for
// PARENT/RIDER rows that carry neither) via their rider / parent→rider link,
// exactly like resolveOrgIdForSession. Returns null when it can't be resolved
// (e.g. a PARENT account created but not yet linked to any rider).
export async function resolveUserOrgId(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true, role: true, centre: { select: { orgId: true } } },
  });
  if (!u) return null;
  let org = u.orgId ?? u.centre?.orgId ?? null;
  if (!org && u.role === "RIDER") {
    const rider = await prisma.rider.findFirst({ where: { userId }, select: { centre: { select: { orgId: true } } } });
    org = rider?.centre.orgId ?? null;
  }
  if (!org && u.role === "PARENT") {
    const link = await prisma.parentLink.findFirst({ where: { parentUserId: userId }, select: { rider: { select: { centre: { select: { orgId: true } } } } } });
    org = link?.rider.centre.orgId ?? null;
  }
  return org;
}

// STRICT: true only when the target resolves to the caller's exact org. Used by
// user-management writes (reset-password/role/delete) — an unresolvable target
// is treated as "not mine" and blocked. Stops cross-org account takeover.
export async function callerSharesOrgWithUser(session: SessionPayload, targetUserId: string): Promise<boolean> {
  const callerOrg = await getOrgIdForSession(session);
  if (!callerOrg) return false;
  const targetOrg = await resolveUserOrgId(targetUserId);
  return targetOrg !== null && targetOrg === callerOrg;
}

// LENIENT: true only when the target resolves to a DIFFERENT non-null org. Used
// when attaching an as-yet-unscoped account (e.g. linking an existing PARENT to
// a rider) — an unlinked parent (org null) is allowed; one already in another
// org is blocked.
export async function userIsInForeignOrg(session: SessionPayload, userId: string): Promise<boolean> {
  const [callerOrg, targetOrg] = await Promise.all([getOrgIdForSession(session), resolveUserOrgId(userId)]);
  return targetOrg !== null && callerOrg !== null && targetOrg !== callerOrg;
}
