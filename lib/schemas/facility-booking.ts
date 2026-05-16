import { z } from "zod";

export const FACILITY_BOOKING_PURPOSES = ["exam", "competition", "lesson", "maintenance", "other"] as const;

const dt = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "ISO datetime");

export const createBookingSchema = z.object({
  facilityId: z.string().min(1),
  purpose: z.enum(FACILITY_BOOKING_PURPOSES),
  title: z.string().min(1).max(120),
  startAt: dt,
  endAt: dt,
  refType: z.string().max(40).optional(),
  refId: z.string().max(80).optional(),
  notes: z.string().max(500).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
