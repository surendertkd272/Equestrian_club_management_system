import { z } from "zod";

// ScoringTemplate categoriesJson shape — keep simple to round-trip JSON safely.
export type RubricItem = {
  name: string;
  max_score: number;
  type?: "numeric" | "text" | "number" | "select";
  options?: string[];
};

export type RubricCategory = {
  name: string;
  type?: "numeric" | "text" | "select";
  items: RubricItem[];
  options?: string[]; // only used when type === "select"
};

const itemSchema: z.ZodType<RubricItem> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    max_score: z.number().min(0),
    type: z.enum(["numeric", "text", "number", "select"]).optional(),
    options: z.array(z.string()).optional(),
  }),
);

const categorySchema: z.ZodType<RubricCategory> = z.object({
  name: z.string().min(1),
  type: z.enum(["numeric", "text", "select"]).optional(),
  items: z.array(itemSchema).min(1),
  options: z.array(z.string()).optional(),
});

export const rubricSchema = z.array(categorySchema);

// Accepts either a JSON string (legacy reads + tests) or a parsed JsonValue
// (native Postgres jsonb columns). Returns [] for anything that doesn't shape
// up — this stays forgiving so a malformed legacy row doesn't crash the page.
export function parseRubric(json: unknown): RubricCategory[] {
  if (json === null || json === undefined || json === "") return [];
  try {
    const v = typeof json === "string" ? JSON.parse(json) : json;
    const r = rubricSchema.safeParse(v);
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}

// API: schedule a new exam
export const createExamSchema = z.object({
  riderId: z.string().min(1),
  examinerId: z.string().min(1),
  level: z.coerce.number().int().min(1).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
});

// API: save draft or final score submission. Optional `judgeId` is set when
// a co-judge submits their own card; the route picks the right ExamJudge
// row and writes there instead of Exam.scoresJson. Deductions / timeFaults
// reduce the final aggregate score before pass/fail evaluation.
export const updateExamScoreSchema = z.object({
  scores: z.record(z.union([z.number(), z.string()])),
  final: z.boolean().default(false),
  judgeId: z.string().min(1).optional(),
  deductions: z.coerce.number().min(0).max(1000).optional(),
  timeFaults: z.coerce.number().min(0).max(1000).optional(),
});

export const updateScoringTemplateSchema = z.object({
  levelName: z.string().min(1),
  passThreshold: z.coerce.number().int().min(0).max(100),
  categories: rubricSchema,
});

export function computeTotal(categories: RubricCategory[], scores: Record<string, number | string>): { total: number; max: number } {
  // Sum numeric items only. Text/select categories don't contribute.
  // Mirror the ScoringEngine rule that "Miscellaneous Questions" is excluded from totals.
  let total = 0;
  let max = 0;
  for (const cat of categories) {
    if (cat.type && cat.type !== "numeric") continue;
    if (cat.name === "Miscellaneous Questions") continue;
    for (const item of cat.items) {
      if (item.type && item.type !== "numeric") continue;
      max += item.max_score;
      const v = scores[`${cat.name}_${item.name}`];
      if (typeof v === "number") total += v;
    }
  }
  return { total, max };
}
