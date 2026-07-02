import { z } from "zod";

// PATCH payload for /api/staff/[id]. Every field optional — the caller sends
// only what they changed (partial edit).
//
// Scope: this endpoint covers a staff member's HR-record fields only — the
// display name + phone on the linked User, plus salary band and the real date
// of joining on the Staff row. Identity + privilege edits (email, role, account
// status, centre transfer) stay on the HQ Users admin flow (/api/users/[id]),
// which carries the last-super-admin / self-lockout / email-uniqueness guards.
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const updateStaffSchema = z
  .object({
    // Lives on the linked User.
    name: z.string().min(2).max(80),
    phone: z
      .string()
      .min(10)
      .max(20)
      .nullable()
      .or(z.literal("").transform(() => null)),
    // Lives on the Staff row. `.min(1)` so a blank string falls through to the
    // empty-literal branch and normalises to null (an unconstrained string
    // would accept "" and short-circuit the union, storing "" instead of null).
    salaryBand: z
      .string()
      .min(1)
      .max(40)
      .nullable()
      .or(z.literal("").transform(() => null)),
    joiningDate: dateString,
  })
  .partial();

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
