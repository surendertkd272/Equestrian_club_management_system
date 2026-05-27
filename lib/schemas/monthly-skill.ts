import { z } from "zod";

// Monthly Skills — coach picks a small set of skills to track for the
// current month, then marks each rider's progress at month-end. yearMonth
// is the canonical key (e.g. "2026-05"). Rating scale 0-3: 0 not yet,
// 1 needs work, 2 confident, 3 mastered.

const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM required");

export const SKILL_RATING_LABELS: Record<number, string> = {
  0: "Not yet",
  1: "Needs work",
  2: "Confident",
  3: "Mastered",
};

export const createSkillSchema = z.object({
  yearMonth,
  skillLabel: z.string().min(2).max(120),
});

export const updateSkillSchema = z.object({
  skillLabel: z.string().min(2).max(120).optional(),
  orderIndex: z.coerce.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});

export const markSkillSchema = z.object({
  catalogId: z.string().min(1),
  riderId: z.string().min(1),
  rating: z.coerce.number().int().min(0).max(3),
  coachNotes: z.string().max(500).optional(),
});

export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type MarkSkillInput = z.infer<typeof markSkillSchema>;
