import { z } from "zod";

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

export const createApprovalSchema = z.object({
  entityType: z.string().min(1).max(40),
  entityId: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  body: z.string().max(2000).optional(),
});

export const reviewApprovalSchema = z.object({
  decision: z.enum(["approved", "rejected", "cancelled"]),
  reviewNotes: z.string().max(800).optional(),
});

export type CreateApprovalInput = z.infer<typeof createApprovalSchema>;
