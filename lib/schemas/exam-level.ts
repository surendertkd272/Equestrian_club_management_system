import { z } from "zod";

export const EXAM_DISCIPLINES = [
  "general",
  "dressage",
  "jumping",
  "eventing",
  "gymkhana",
  "endurance",
  "vaulting",
  "polo",
] as const;
export type ExamDiscipline = (typeof EXAM_DISCIPLINES)[number];

// Validation for an HQ-curated catalog row. `orderIndex` is the sort key
// within a discipline (1 = entry, increasing). `code` is the short ID
// shown in lists; `name` is the full label printed on certificates.
export const createExamLevelSchema = z.object({
  discipline: z.enum(EXAM_DISCIPLINES).default("general"),
  orderIndex: z.coerce.number().int().min(1).max(50),
  code: z.string().min(1).max(20),
  name: z.string().min(2).max(80),
  passThreshold: z.coerce.number().int().min(0).max(100).default(70),
  description: z.string().max(500).optional(),
  defaultRubricJson: z.string().optional(),
  minExaminerLevel: z.coerce.number().int().min(1).max(50).optional(),
  active: z.boolean().default(true),
});

export const updateExamLevelSchema = createExamLevelSchema.partial();

export type CreateExamLevelInput = z.infer<typeof createExamLevelSchema>;
