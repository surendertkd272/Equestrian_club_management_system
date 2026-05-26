import { z } from "zod";
import { ROLES } from "../roles";

// pending_approval = staff hiring invite was redeemed; user can't sign in
// until an admin reviews + activates them. resigned / terminated capture
// the employee lifecycle exits (kept distinct so HR can filter on cause).
export const USER_STATUSES = ["active", "suspended", "pending_approval", "resigned", "terminated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// HQ-side user edit. Email + role + centre + status are deliberately co-located
// on this schema because they're the levers HQ pulls when reorganising staff
// across clubs; the route enforces the last-super-admin guard separately.
//
// Notably absent: passwordHash + twoFactor. Password rotation goes through the
// reset-password route which writes an audit trail and returns the temp once;
// 2FA toggle is a future feature.
export const updateUserSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(20).nullable().optional(),
  role: z.enum(ROLES as readonly [string, ...string[]]).optional(),
  centreId: z.string().min(1).nullable().optional(),
  status: z.enum(USER_STATUSES).optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// HQ-side user create. Password is generated server-side and returned ONCE;
// callers can't supply one (keeps the "temp password shown one time" model
// consistent with reset-password + rider portal access).
export const createUserSchema = z.object({
  name: z.string().min(2).max(150),
  email: z.string().email().max(200),
  phone: z.string().max(20).optional().or(z.literal("")),
  role: z.enum(ROLES as readonly [string, ...string[]]),
  centreId: z.string().min(1).nullable().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
