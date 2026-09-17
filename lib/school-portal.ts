import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getOrgIdForSession } from "@/lib/features-gate";
import { schoolScopeFor, riderScopeWhere, type SchoolScope } from "@/lib/school-scope";

// One resolver for every page in the school portal.
//
// The portal is five pages that all answer "which children may this account
// see", and the answer has to be identical on all of them. Working it out
// per-page is how one of them ends up a page behind the fence — which is the
// exact bug this portal already had once, when attendance was filtered by the
// batch's centre while the rider list was filtered by school.

export type SchoolContext = {
  userId: string;
  centreId: string;
  centreName: string;
  scope: SchoolScope;
  /** Spread into any rider query. Already carries the centre. */
  riderWhere: { centreId: string; schoolId?: string };
  /** What to call this view — the school when fenced, else the club. */
  title: string;
};

/**
 * Resolve the signed-in school administrator's context, or redirect.
 *
 * Returns null ONLY when the account has no centre, which the caller renders
 * as an explanatory card rather than a redirect loop.
 */
export async function schoolContext(): Promise<SchoolContext | null> {
  const session = await requireSession();
  const centreId = session.centreId;
  if (!centreId) return null;

  // Binds the RLS tenant org for every query that follows.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const centre = await prisma.centre.findFirst({
    where: { id: centreId, orgId },
    select: { name: true },
  });
  if (!centre) return null;

  const scope = await schoolScopeFor(session.userId);
  return {
    userId: session.userId,
    centreId,
    centreName: centre.name,
    scope,
    riderWhere: riderScopeWhere(centreId, scope),
    title: scope.schoolName ?? centre.name,
  };
}
