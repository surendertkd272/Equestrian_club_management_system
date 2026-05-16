import { z } from "zod";

// Federation-recognised role names. Keep as a free-form string field on
// the model so a tenant can add a custom role (e.g. "announcer") without
// a schema change, but expose this enum at the API boundary so the
// dropdown can't introduce typos.
export const OFFICIAL_ROLES = [
  "ground_jury_president",
  "ground_jury",
  "technical_delegate",
  "course_designer",
  "steward",
  "veterinarian",
  // Per-letter dressage judges (a 3-judge panel = C+E+B; 5-judge = +M+H)
  "judge_c",
  "judge_e",
  "judge_b",
  "judge_m",
  "judge_h",
  "judge", // generic / jumping / gymkhana
] as const;
export type OfficialRole = (typeof OFFICIAL_ROLES)[number];

export const appointOfficialSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(OFFICIAL_ROLES),
  classNames: z.string().max(400).optional().nullable(), // CSV
});
