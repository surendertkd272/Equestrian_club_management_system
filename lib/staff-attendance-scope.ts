import type { Role } from "@/lib/roles";
import { can } from "@/lib/permissions";

// Who a signed-in user may mark staff attendance FOR.
//
// Managers, head coaches and stable managers hold staff.attendance and mark
// anyone at their centre. A coach runs the yard with grooms under them each
// morning and is the person who actually knows whether a groom turned up —
// but a coach marking another coach, a manager or the accountant would be a
// junior signing off a senior's register. So a coach gets the grooms, and only
// the grooms.
export type StaffAttendanceScope = "all" | "ground_staff";

export const GROUND_STAFF_ROLES: readonly Role[] = ["GROOM"];

export function staffAttendanceScope(role: Role): StaffAttendanceScope | null {
  if (can(role, "staff.attendance")) return "all";
  if (role === "COACH") return "ground_staff";
  return null;
}

// targetRole is a string because User.role is a plain column, not the Role union.
export function mayMarkStaff(scope: StaffAttendanceScope, targetRole: string): boolean {
  return scope === "all" || (GROUND_STAFF_ROLES as readonly string[]).includes(targetRole);
}
