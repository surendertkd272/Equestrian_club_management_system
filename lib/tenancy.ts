import type { SessionPayload } from "./auth";
import { cookies } from "next/headers";

// Returns the centreId the request is scoped to.
// SUPER_ADMIN and ADMIN can pass ?centre=<id> to narrow; otherwise everyone
// is locked to their own. The HQ cookie `ew_hq_centre` persists their last
// pick across navigation (request param wins when both are set).
export function scopeCentre(session: SessionPayload, requestedCentreId?: string | null): string | null {
  // HQ tier (SUPER_ADMIN, ADMIN) — picker-driven, defaults to "all centres".
  if (session.role === "SUPER_ADMIN" || session.role === "ADMIN") {
    if (requestedCentreId !== undefined) {
      // Empty string => clear the filter back to "all". Distinct from
      // "undefined" which means "no explicit pick this request → use cookie".
      if (requestedCentreId === "" || requestedCentreId === "all") return null;
      return requestedCentreId;
    }
    // Fall back to the persisted cookie so the picker survives refreshes.
    try {
      const cookie = cookies().get("ew_hq_centre")?.value;
      if (cookie && cookie !== "all") return cookie;
    } catch {
      // cookies() throws outside a request scope (tests etc) — ignore.
    }
    return null;
  }
  // Centre-scoped roles: pinned to their own centre.
  if (!session.centreId) throw new Error("USER_HAS_NO_CENTRE");
  if (requestedCentreId && requestedCentreId !== session.centreId) {
    throw new Error("FORBIDDEN_CROSS_CENTRE");
  }
  return session.centreId;
}

// Build a Prisma `where` fragment that enforces centre scope.
// Pass the result of scopeCentre() — null means "all centres" (HQ).
// Return type is explicit (rather than inferred as `{ centreId: string } | {}`)
// so callers can drop the result into nested filter positions without an
// `as any` cast — `{ centreId?: string }` is structurally a subset of every
// Prisma *WhereInput that has a centreId column.
export function centreWhere(centreId: string | null): { centreId?: string } {
  return centreId ? { centreId } : {};
}

// Org-aware scope for centre-owned tables (those with a `centre` relation).
// Closes the cross-tenant gap where an HQ user's "all centres" (centreId=null)
// produced an EMPTY filter and leaked every org's rows. Always binds the org,
// so:
//   - "all centres"      → { centre: { orgId } }                 (org-bounded, not global)
//   - a specific centre  → { centreId, centre: { orgId } }       (a foreign centreId
//                                                                  can never match → 0 rows)
// Pass the caller's resolved orgId (getOrgIdForSession). orgId must be non-null
// for HQ callers; callers should fail closed if it can't be resolved.
export function tenantWhere(
  centreId: string | null,
  orgId: string | null,
): { centreId?: string; centre?: { orgId: string } } {
  const w: { centreId?: string; centre?: { orgId: string } } = {};
  if (centreId) w.centreId = centreId;
  if (orgId) w.centre = { orgId };
  return w;
}
