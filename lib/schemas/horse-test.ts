import { z } from "zod";
import { optionalStoredUrl } from "@/lib/schemas/url";

// Lab tests done on a horse. Two of these (Coggins / Glanders) are
// compliance-mandated for inter-state and competition transport in India;
// Urination (urinalysis) is a routine diagnostic.
export const HORSE_TEST_TYPES = ["coggins", "glanders", "urination"] as const;
export type HorseTestType = (typeof HORSE_TEST_TYPES)[number];

export const HORSE_TEST_RESULTS = ["negative", "positive", "pending", "inconclusive"] as const;

export const createHorseTestSchema = z.object({
  testType: z.enum(HORSE_TEST_TYPES),
  result: z.enum(HORSE_TEST_RESULTS).default("pending"),
  testedAt: z.string().datetime().optional(),
  nextDueAt: z.string().datetime().nullable().optional(),
  labName: z.string().max(120).optional(),
  reportUrl: optionalStoredUrl,
  notes: z.string().max(500).optional(),
});

export type CreateHorseTestInput = z.infer<typeof createHorseTestSchema>;
