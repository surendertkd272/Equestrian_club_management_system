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
 * Organisation an HQ caller belongs to.
 *
 * HQ users (SUPER_ADMIN, ADMIN) carry no centreId, so their org comes from
 * User.orgId — a column added later, leaving legacy rows null. The original
 * fallback for those rows was `SELECT "orgId" FROM "Centre" LIMIT 1`: an
 * ARBITRARY row, with no ORDER BY. On a single-tenant install that is always
 * the right answer. On a multi-tenant one it is a coin toss, and it lands
 * exactly backwards — a legacy admin gets some OTHER organisation's id, is then
 * refused their own org's rows, and is GRANTED the stranger's. Reproduced: such
 * an admin renamed a batch belonging to a different club.
 *
 * The same fallback lives in resolveOrgIdForSession (lib/features-gate.ts),
 * which is what stamps app.org_id for the row-level-security policies — so the
 * database backstop inherited the wrong guess and bound the foreign org too.
 * Both now call this.
 *
 * Guessing is never safe when there is more than one organisation to guess
 * between, so the fallback only applies when the install has exactly one.
 * Otherwise this returns null and every caller fails closed.
 */
export async function orgOfHqUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  if (user?.orgId) return user.orgId;
  const orgs = await prisma.organisation.findMany({ select: { id: true }, take: 2 });
  return orgs.length === 1 ? orgs[0].id : null;
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

/**
 * A fence for checking MANY rows in one request.
 *
 * centreFence() resolves the caller's organisation on every call, so using it
 * inside a loop turns a bulk action over 200 invoices into 400 queries. This
 * resolves the caller's org once and memoises centre → org, so a bulk route
 * costs one query per DISTINCT centre instead of two per row. Centre-scoped
 * callers cost nothing either way — their check is a string comparison.
 */
export function makeCentreFence(session: FenceSession) {
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  let callerOrg: Promise<string | null> | null = null;
  const centreOrgs = new Map<string, Promise<string | null>>();

  return async function fence(
    rowCentreId: string | null,
  ): Promise<"FORBIDDEN_CROSS_ORG" | "FORBIDDEN_CROSS_CENTRE" | null> {
    if (!isHQ) return rowCentreId !== session.centreId ? "FORBIDDEN_CROSS_CENTRE" : null;
    if (!rowCentreId) return null;
    callerOrg ??= orgOfHqUser(session.userId);
    if (!centreOrgs.has(rowCentreId)) centreOrgs.set(rowCentreId, orgOfCentre(rowCentreId));
    const [mine, theirs] = await Promise.all([callerOrg, centreOrgs.get(rowCentreId)!]);
    return !mine || mine !== theirs ? "FORBIDDEN_CROSS_ORG" : null;
  };
}

/**
 * The WHERE fragment that scopes a list query to what this caller may see.
 *
 * `tenantWhere` (lib/tenancy.ts) expresses the org half as a relation filter,
 * `centre: { orgId }` — which only compiles on models that declare a `centre`
 * relation. Several do not (Course, Farrier, Vaccination, Consumable,
 * FacilityBooking all carry a bare centreId column), and Prisma rejects the
 * query outright. This expresses the same scope as an id list, which works on
 * anything with a centreId.
 *
 * Returns null when the caller has no legitimate scope at all, so the route can
 * fail closed rather than list the platform.
 */
export async function centreScopeWhere(
  session: FenceSession,
): Promise<{ centreId: string } | { centreId: { in: string[] } } | null> {
  if (session.centreId) return { centreId: session.centreId };
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ) return null; // a centre-less non-HQ role sees nothing here
  const org = await orgOfHqUser(session.userId);
  if (!org) return null;
  const centres = await prisma.centre.findMany({ where: { orgId: org }, select: { id: true } });
  return { centreId: { in: centres.map((c) => c.id) } };
}
