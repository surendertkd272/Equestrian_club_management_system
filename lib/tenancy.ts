import type { SessionPayload } from "./auth";

// Returns the centreId the request is scoped to.
// Super Admin can pass ?centre=<id> to scope; otherwise everyone is locked to their own.
export function scopeCentre(session: SessionPayload, requestedCentreId?: string | null): string | null {
  if (session.role === "SUPER_ADMIN") return requestedCentreId ?? null; // null = all centres
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
