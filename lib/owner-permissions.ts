// Permission matrix for platform-team roles. Mirrors lib/permissions.ts on the
// tenant side, kept separate so the two RBAC trees never cross-pollinate.
//
// OWNER_ADMIN   — full access. Onboards tenants, changes plans, manages the team.
// OWNER_EDITOR  — read everything; can rename tenants and edit contact info.
//                 Can't touch billing, status, plan, features, or the team.
// OWNER_BILLING — read everything; can edit billing email and flip status
//                 (active ↔ past_due ↔ suspended). Can't rename tenants or
//                 change plans.

import { NextResponse } from "next/server";
import type { OwnerRole } from "./owner-auth";

export type OwnerPerm =
  | "tenant.read"
  | "tenant.edit_metadata"   // name, contactName, phone
  | "tenant.edit_billing"    // billingEmail
  | "tenant.change_status"   // active | trial | past_due | suspended
  | "tenant.change_plan"     // starter | pro | enterprise (rewrites OrgFeature)
  | "tenant.toggle_features" // individual feature override (Enterprise only)
  | "tenant.create"          // run the onboarding wizard
  | "team.manage";           // invite / edit / suspend platform users

const MATRIX: Record<OwnerRole, readonly OwnerPerm[]> = {
  OWNER_ADMIN: [
    "tenant.read",
    "tenant.edit_metadata",
    "tenant.edit_billing",
    "tenant.change_status",
    "tenant.change_plan",
    "tenant.toggle_features",
    "tenant.create",
    "team.manage",
  ],
  OWNER_EDITOR: ["tenant.read", "tenant.edit_metadata"],
  OWNER_BILLING: ["tenant.read", "tenant.edit_billing", "tenant.change_status"],
};

export function ownerCan(role: OwnerRole, perm: OwnerPerm): boolean {
  return MATRIX[role]?.includes(perm) ?? false;
}

// Convenience for route handlers — returns a 403 response if the role lacks
// the permission, or null to continue.
export function forbidIfMissingOwnerPerm(
  role: OwnerRole,
  perm: OwnerPerm,
): NextResponse | null {
  if (!ownerCan(role, perm)) {
    return NextResponse.json({ error: "FORBIDDEN", required: perm }, { status: 403 });
  }
  return null;
}
