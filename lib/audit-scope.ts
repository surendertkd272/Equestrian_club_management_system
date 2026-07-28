import type { Prisma } from "@prisma/client";

// The tenant scope for AuditLog, in one place.
//
// AuditLog has no org column of its own, so rows are attributed through the
// ACTOR. Three things make that harder than it looks, and each has already
// caused a defect:
//
//   • PARENT and RIDER accounts carry neither orgId nor centreId — their
//     organisation is reached through the rider they are linked to. Omit those
//     paths and a family's actions are invisible to their own club.
//   • System entries (cron sweeps, SMS and WhatsApp dispatch) have no actor at
//     all and no tenant column, so they cannot be attributed to anyone. They go
//     to HQ, who operate the platform, and not to centre staff.
//   • The screen and its CSV export had drifted apart twice — once with the
//     export scoped and the screen not, once the reverse. One helper, both
//     callers.
//
// Callers must place this in an AND slot, never at `where.OR`: the audit
// screen's free-text search assigns to `where.OR`, and an earlier version of
// this scope lived there and was silently overwritten by it.
export function auditScopeFor(role: string, orgId: string): Prisma.AuditLogWhereInput {
  const isHQ = role === "SUPER_ADMIN" || role === "ADMIN";
  return {
    OR: [
      { user: { orgId } },
      { user: { centre: { orgId } } },
      { user: { parentLinks: { some: { rider: { centre: { orgId } } } } } },
      { user: { rider: { centre: { orgId } } } },
      ...(isHQ ? [{ userId: null }] : []),
    ],
  };
}
