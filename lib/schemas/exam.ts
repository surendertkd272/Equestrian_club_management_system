import { z } from "zod";

// ScoringTemplate categoriesJson shape — keep simple to round-trip JSON safely.
// An item is either a leaf (numeric max_score, scored directly) or a parent
// (max_score may be null and `subitems` holds the actual scored children).
// Parents exist for natural groupings like Level 3 "Small Jumps" and
// Level 4 "Gallop Run (1)" / "TENT PEGGING 1 RUN" from the Equiwings PDFs.
export type RubricItem = {
  name: string;
  max_score: number | null;
  type?: "numeric" | "text" | "number" | "select";
  options?: string[];
  subitems?: RubricItem[];
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
    // null is valid for parent items whose score is the sum of subitems.
    max_score: z.number().min(0).nullable(),
    type: z.enum(["numeric", "text", "number", "select"]).optional(),
    options: z.array(z.string()).optional(),
    subitems: z.array(itemSchema).optional(),
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
  // Set by the UI only after the examiner confirms an explicitly partial card.
  // A final submission is otherwise refused when rubric items are unscored —
  // see countUnscored below.
  allowIncomplete: z.boolean().optional(),
});

export const updateScoringTemplateSchema = z.object({
  levelName: z.string().min(1),
  passThreshold: z.coerce.number().int().min(0).max(100),
  categories: rubricSchema,
});

export function computeTotal(categories: RubricCategory[], scores: Record<string, number | string>): { total: number; max: number } {
  // Sum numeric items only. Text/select categories don't contribute.
  // Mirror the ScoringEngine rule that "Miscellaneous Questions" is excluded from totals.
  // Parent items (max_score=null + subitems[]) don't contribute themselves;
  // their sub-items do, keyed as `${cat.name}_${item.name}_${sub.name}`.
  let total = 0;
  let max = 0;
  for (const cat of categories) {
    if (cat.type && cat.type !== "numeric") continue;
    if (cat.name === "Miscellaneous Questions") continue;
    for (const item of cat.items) {
      if (item.type && item.type !== "numeric") continue;
      if (Array.isArray(item.subitems) && item.subitems.length > 0) {
        for (const sub of item.subitems) {
          if (sub.type && sub.type !== "numeric") continue;
          max += sub.max_score ?? 0;
          const v = scores[`${cat.name}_${item.name}_${sub.name}`];
          if (typeof v === "number") total += v;
        }
      } else {
        max += item.max_score ?? 0;
        const v = scores[`${cat.name}_${item.name}`];
        if (typeof v === "number") total += v;
      }
    }
  }
  return { total, max };
}

// Find numeric scores that fall outside their rubric item's [0, max_score]
// range. Without this an examiner (or a hand-rolled request) can submit a
// per-item score above the item's max — inflating the total past `max` and
// flipping a fail into a pass. Traversal mirrors computeTotal exactly so the
// same keys/skip rules apply (text/select items and "Miscellaneous Questions"
// are not scored, so they're never range-checked).
export function findScoreViolations(
  categories: RubricCategory[],
  scores: Record<string, number | string>,
): Array<{ key: string; value: number; max: number }> {
  const out: Array<{ key: string; value: number; max: number }> = [];
  const check = (key: string, maxScore: number | null) => {
    const v = scores[key];
    if (typeof v !== "number") return;
    const max = maxScore ?? 0;
    if (v < 0 || v > max) out.push({ key, value: v, max });
  };
  for (const cat of categories) {
    if (cat.type && cat.type !== "numeric") continue;
    if (cat.name === "Miscellaneous Questions") continue;
    for (const item of cat.items) {
      if (item.type && item.type !== "numeric") continue;
      if (Array.isArray(item.subitems) && item.subitems.length > 0) {
        for (const sub of item.subitems) {
          if (sub.type && sub.type !== "numeric") continue;
          check(`${cat.name}_${item.name}_${sub.name}`, sub.max_score);
        }
      } else {
        check(`${cat.name}_${item.name}`, item.max_score);
      }
    }
  }
  return out;
}

// How many scorable rubric items have no number against them, and how many
// there are in total.
//
// An unscored item counts as zero in computeTotal, so a card the examiner only
// half-filled submits as a legitimate-looking low score. Observed: a card with
// 1 of 37 items filled locked in at 2/91 as a permanent FAIL, and the parents
// were notified of the result. Nothing in the flow asked "are you sure?".
export function countUnscored(
  categories: RubricCategory[],
  scores: Record<string, number | string>,
): { unscored: number; total: number } {
  let unscored = 0;
  let total = 0;
  const seen = (key: string) => {
    total += 1;
    if (typeof scores[key] !== "number") unscored += 1;
  };
  for (const cat of categories) {
    if (cat.type && cat.type !== "numeric") continue;
    if (cat.name === "Miscellaneous Questions") continue;
    for (const item of cat.items) {
      if (item.type && item.type !== "numeric") continue;
      if (Array.isArray(item.subitems) && item.subitems.length > 0) {
        for (const sub of item.subitems) {
          if (sub.type && sub.type !== "numeric") continue;
          seen(`${cat.name}_${item.name}_${sub.name}`);
        }
      } else {
        seen(`${cat.name}_${item.name}`);
      }
    }
  }
  return { unscored, total };
}
