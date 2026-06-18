import { prisma } from "@/lib/prisma";
import { getOrgIdForSession } from "@/lib/features-gate";
import type { SessionPayload } from "@/lib/auth";

// The User and Centre tables are RLS-permissive (identity tables), so DB-level
// org isolation does NOT cover writes to them — the app layer must enforce it.
// Without this, an HQ admin of org A can reset/promote/delete org B's users.
//
// Resolves the target user's org (explicit orgId, else via their centre) and
// compares it to the caller's org. Returns true only when they match.
export async function callerSharesOrgWithUser(
  session: SessionPayload,
  targetUserId: string,
): Promise<boolean> {
  const callerOrg = await getOrgIdForSession(session);
  if (!callerOrg) return false;
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { orgId: true, role: true, centre: { select: { orgId: true } } },
  });
  if (!target) return false;

  let targetOrg = target.orgId ?? target.centre?.orgId ?? null;
  // PARENT/RIDER User rows carry no orgId/centreId — their org is derived from
  // the rider (and parent→rider link), exactly like resolveOrgIdForSession.
  if (!targetOrg && target.role === "RIDER") {
    const rider = await prisma.rider.findFirst({ where: { userId: targetUserId }, select: { centre: { select: { orgId: true } } } });
    targetOrg = rider?.centre.orgId ?? null;
  }
  if (!targetOrg && target.role === "PARENT") {
    const link = await prisma.parentLink.findFirst({ where: { parentUserId: targetUserId }, select: { rider: { select: { centre: { select: { orgId: true } } } } } });
    targetOrg = link?.rider.centre.orgId ?? null;
  }
  return targetOrg !== null && targetOrg === callerOrg;
}
