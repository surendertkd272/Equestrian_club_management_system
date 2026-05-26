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
export function centreWhere(centreId: string | null) {
  return centreId ? { centreId } : {};
}
