// Vendor visibility: a centre sees its OWN vendors plus any "national"
// (all-India delivery) vendor in the SAME org. HQ users with no centre filter
// (scopeCentre → null) see every vendor. Returns a Prisma `where` fragment to
// merge into vendor queries.

import { prisma } from "./prisma";
import { scopeCentre } from "./tenancy";
import { getOrgIdForSession } from "./features-gate";
import type { SessionPayload } from "./auth";

export async function vendorScopeWhere(session: SessionPayload): Promise<Record<string, unknown>> {
  // scopeCentre() throws for a centre-less non-HQ role (a PARENT has
  // centreId = null), and this helper is awaited straight from the route with
  // nothing to catch it — so GET /api/vendors answered 500 instead of refusing.
  // Fail CLOSED here: match nothing, and let the route's own role guard decide
  // the status code. HQ users legitimately resolve to null and keep the
  // org-wide branch below.
  let centreId: string | null;
  try {
    centreId = scopeCentre(session);
  } catch {
    return { id: "__no_centre_scope__" };
  }
  if (!centreId) {
    // HQ "all centres" view — bound to the caller's OWN org (C1), not every
    // tenant's vendors. Fail closed (match nothing) if org can't resolve.
    const orgId = await getOrgIdForSession(session);
    return orgId ? { centre: { orgId } } : { id: "__no_org__" };
  }

  // National vendors are org-wide; resolve the centre's org so we never leak
  // another tenant's national vendors.
  const centre = await prisma.centre.findUnique({
    where: { id: centreId },
    select: { orgId: true },
  });
  const orgId = centre?.orgId ?? null;

  return {
    OR: [
      { centreId },
      orgId
        ? { deliveryScope: "national", centre: { orgId } }
        : { deliveryScope: "national" },
    ],
  };
}
