import { z } from "zod";

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const markAttendanceSchema = z.object({
  batchId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
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
