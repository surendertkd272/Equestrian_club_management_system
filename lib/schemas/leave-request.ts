import { z } from "zod";

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const createLeaveRequestSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
    reason: z.string().min(3).max(500),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

// Reviewer action: approve or reject (with optional notes). "cancelled" is
// requester-driven and goes through a different code path on the route.
export const reviewLeaveRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewNotes: z.string().max(500).optional(),
});

export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;
export type ReviewLeaveRequestInput = z.infer<typeof reviewLeaveRequestSchema>;
