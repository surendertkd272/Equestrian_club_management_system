import { z } from "zod";

// Sponsor tiers — same ordering most equestrian programmes print on signage.
export const SPONSOR_TIERS = ["title", "platinum", "gold", "silver", "bronze", "partner"] as const;

export const createSponsorSchema = z.object({
  name: z.string().min(1).max(120),
  tier: z.enum(SPONSOR_TIERS).default("partner"),
  contactName: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
  contactEmail: z.string().email().max(200).optional().or(z.literal("")),
  contribution: z.coerce.number().nonnegative().optional(),
  notes: z.string().max(500).optional(),
  logoUrl: z.string().url().max(500).optional().or(z.literal("")),
});

export const createPrizeSchema = z.object({
  className: z.string().min(1).max(120),
  placement: z.coerce.number().int().min(1).max(20),
  title: z.string().min(1).max(80),
  cashAmount: z.coerce.number().nonnegative().optional(),
  trophyLabel: z.string().max(80).optional(),
  sponsoredById: z.string().nullable().optional(),
  notes: z.string().max(300).optional(),
});

// Draw payload: caller passes the class to draw for. The server collects every
// non-withdrawn entry in that class, shuffles them, and inserts StartListEntry
// rows with sequential order. Idempotent within a competition: re-running on
// the same class deletes the previous rows for that class and redraws — useful
// when entries change after the first draw. Flagged "completed" only when the
// caller explicitly says so via finalise=true.
export const drawLotsSchema = z.object({
  className: z.string().min(1).max(120),
  finalise: z.boolean().optional().default(false),
});

export type CreateSponsorInput = z.infer<typeof createSponsorSchema>;
export type CreatePrizeInput = z.infer<typeof createPrizeSchema>;
