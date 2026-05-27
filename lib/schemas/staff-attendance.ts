import { z } from "zod";

// Status set differs from rider attendance: staff include "leave" (approved
// time-off that surfaces in attendance reports) and "half_day", no "excused".
// half_day lets payroll apply a partial deduction (see PayrollConfig).
export const STAFF_ATTENDANCE_STATUSES = ["present", "absent", "late", "leave", "half_day"] as const;
export type StaffAttendanceStatus = (typeof STAFF_ATTENDANCE_STATUSES)[number];

// Mark / upsert a single staff attendance row. The (userId, date) tuple is unique,
// so a re-submit corrects the prior mark — the same shape we use for rider attendance.
export const markStaffAttendanceSchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  status: z.enum(STAFF_ATTENDANCE_STATUSES),
  // Optional check-in/out — HH:MM in local time; stored as a full datetime on the marked date.
  checkInAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  checkOutAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  overtimeHours: z.coerce.number().nonnegative().max(24).optional(),
  notes: z.string().max(500).optional(),
});

export type MarkStaffAttendanceInput = z.infer<typeof markStaffAttendanceSchema>;

// Combine a date-only string with an HH:MM time-of-day into a single Date (UTC).
export function composeDateTime(dateYMD: string, timeHM: string): Date {
  const [y, m, d] = dateYMD.split("-").map(Number);
  const [hh, mm] = timeHM.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
}
