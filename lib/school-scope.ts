import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";

// What a school administrator is allowed to see.
//
// The role was fenced to a CENTRE, so an administrator saw every rider at their
// club whatever school the child attended. That was correct while each partner
// centre served one school and wrong the moment one did not — GHRC Equiwings
// already carries riders from four schools, so handing any one of them a login
// would have shown them the others' children.
//
// One function, because the fence has to be identical on every surface that
// ever shows a school administrator a list of children. A second hand-rolled
// `where` somewhere else is how the leak comes back.

export type SchoolScope = {
  /** The school this account is fenced to, or null for the whole centre. */
  schoolId: string | null;
  /** Display name of that school, when fenced. */
  schoolName: string | null;
};

export async function schoolScopeFor(userId: string): Promise<SchoolScope> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { schoolId: true, school: { select: { name: true } } },
  });
  return {
    schoolId: user?.schoolId ?? null,
    schoolName: user?.school?.name ?? null,
  };
}

/**
 * The rider `where` fragment for a school scope.
 *
 * Centre always applies; the school narrows it further when one is set. Spread
 * this into a rider query rather than re-deriving the condition:
 *
 *     where: { ...riderScopeWhere(centreId, scope), status: "active" }
 *
 * NULL schoolId deliberately means "every rider at the centre" rather than
 * "riders with no school". Every existing account has NULL, so this migration
 * changes nobody's access until someone is explicitly attached to a school.
 */
export function riderScopeWhere(
  centreId: string,
  scope: SchoolScope,
): { centreId: string; schoolId?: string } {
  return scope.schoolId ? { centreId, schoolId: scope.schoolId } : { centreId };
}

/**
 * The same fence, for the centre-scoped surfaces OUTSIDE /school/*.
 *
 * The portal's fence stopped at /school/*, and two surfaces a school
 * administrator can genuinely reach were centre-scoped and knew nothing about
 * schools: the CSV export (gated on rider.read, which this role holds, so one
 * click returned every other school's roster with mobiles and emails) and the
 * enrolment decision API (this role's one write, which would have let one
 * school accept or reject another school's child).
 *
 * The staff pages do NOT apply it and do not need to: SCHOOL_ADMINISTRATOR is
 * a portal role that middleware and the admin layout both send to /school, and
 * it is in no nav perm array. If that ever changes — if this role is given a
 * real staff page — every rider query on it needs this fence, because
 * tenantWhere() is a centre rule and a centre can serve four schools.
 *
 * Returns the fragment to spread into a Rider `where`; empty for every other
 * role and for an unfenced administrator (schoolId NULL means the whole
 * centre), so nobody else's view changes.
 *
 * For a model that only reaches a rider through a relation, nest it:
 *
 *     if (fence.schoolId) where.rider = fence;
 */
export async function schoolFenceFor(session: SessionPayload): Promise<{ schoolId?: string }> {
  if (session.role !== "SCHOOL_ADMINISTRATOR") return {};
  const { schoolId } = await schoolScopeFor(session.userId);
  return schoolId ? { schoolId } : {};
}

/**
 * The fence for a handler that acts on ONE rider named in the URL, where the
 * row is already loaded and a `where` fragment is no use.
 *
 * Used by the enrolment decision API: a queue can be filtered, but approve and
 * reject take a rider id, so without this one school could accept or reject
 * another school's child by posting the id.
 */
export async function isOutsideSchoolFence(
  session: SessionPayload,
  riderSchoolId: string | null | undefined,
): Promise<boolean> {
  const fence = await schoolFenceFor(session);
  return Boolean(fence.schoolId) && riderSchoolId !== fence.schoolId;
}

/**
 * Resolve a free-text school name to its canonical row, creating it if new.
 *
 * Called from every path that captures a school name — public registration and
 * bulk import — so a rider arriving by either route is immediately fenceable.
 * Without this the table would only ever hold what the migration backfilled and
 * every new rider would be invisible to their own school's administrator.
 *
 * Returns null for a blank or placeholder value: "nil" and "n/a" are
 * non-answers, and minting a school called Nil that somebody could later be
 * fenced to is worse than recording no school at all.
 */
const NON_ANSWERS = new Set(["nil", "na", "n/a", "none", "-", "--"]);

export async function resolveSchoolId(
  db: { school: { upsert: Function } },
  centreId: string,
  rawName: string | null | undefined,
): Promise<string | null> {
  const name = (rawName ?? "").trim();
  if (!name) return null;
  if (NON_ANSWERS.has(name.toLowerCase())) return null;
  // Upsert rather than find-then-create: bulk import resolves many rows in one
  // pass and two riders from the same new school would otherwise race to insert
  // it and collide on the unique index.
  const row = await db.school.upsert({
    where: { centreId_name: { centreId, name } },
    create: { centreId, name },
    update: {},
  });
  return (row as { id: string }).id;
}
