import { z } from "zod";

export const SKILL_STATUSES = ["not_started", "in_progress", "mastered"] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

export const DISCIPLINES = [
  "normal",
  "dressage",
  "jumping",
  "gymkhana",
  "tent_pegging",
  "endurance",
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const updateSkillStatusSchema = z.object({
  status: z.enum(SKILL_STATUSES),
  coachNotes: z.string().max(500).optional(),
});

// Cycle order for the "tap to advance" UX.
export const NEXT_STATUS: Record<SkillStatus, SkillStatus> = {
  not_started: "in_progress",
  in_progress: "mastered",
  mastered: "not_started",
};
