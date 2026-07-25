import { z } from "zod";

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

// How far either side of today a register may be filled. Coaches legitimately
// back-fill a day or two ("forgot to mark Saturday") and occasionally pre-mark
// an excused absence, but a mistyped year used to be accepted silently: a
// register dated 2030 landed in the table, skewed every attendance percentage
// and absence-streak alert, and was invisible on every screen that shows
// "this month".
const BACKFILL_DAYS = 60;
const FORWARD_DAYS = 30;

function withinAttendanceWindow(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const when = Date.UTC(y, m - 1, d, 12, 0, 0);
  if (Number.isNaN(when)) return false;
  const now = Date.now();
  return (
    when >= now - BACKFILL_DAYS * 86_400_000 && when <= now + FORWARD_DAYS * 86_400_000
  );
}

export const markAttendanceSchema = z.object({
  batchId: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .refine(withinAttendanceWindow, {
      message: `Date must be within the last ${BACKFILL_DAYS} days or the next ${FORWARD_DAYS} — check the year`,
    }),
  entries: z
    .array(
      z.object({
        riderId: z.string().min(1),
        status: z.enum(ATTENDANCE_STATUSES),
        reason: z.string().optional(),
      }),
    )
    .min(1),
});

export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export function parseDateOnly(s: string): Date {
  // Treat YYYY-MM-DD as UTC noon to dodge timezone edge cases for date-only fields.
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
