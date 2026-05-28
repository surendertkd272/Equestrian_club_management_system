import { z } from "zod";

export const COMPETITION_STATUSES = [
  "draft",
  "open_for_entries",
  "live",
  "completed",
  "cancelled",
] as const;

// PRD §4 Module 6 — competition scope. Drives both UI labelling and downstream
// analytics ("inter-school standings", "state representation", etc.).
export const COMPETITION_SCOPES = ["internal", "inter_school", "state", "national"] as const;
export type CompetitionScope = (typeof COMPETITION_SCOPES)[number];

export const COMPETITION_DISCIPLINES = ["generic", "dressage", "jumping", "eventing", "gymkhana"] as const;
export type CompetitionDiscipline = (typeof COMPETITION_DISCIPLINES)[number];

export const ENTRY_STATUSES = ["entered", "withdrawn", "scratched"] as const;

export const competitionClassSchema = z.object({
  name: z.string().min(2).max(80),
  fee: z.coerce.number().min(0).default(0),
  ageGroup: z.string().max(40).optional(),
  maxEntries: z.coerce.number().int().min(1).max(500).optional(),
});

export const createCompetitionSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "lowercase letters, digits and hyphens only"),
  scope: z.enum(COMPETITION_SCOPES).default("internal"),
  discipline: z.enum(COMPETITION_DISCIPLINES).default("generic"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue: z.string().max(120).optional(),
  entryDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  classes: z.array(competitionClassSchema).min(1, "Define at least one class"),
});

export const updateCompetitionSchema = z.object({
  status: z.enum(COMPETITION_STATUSES).optional(),
  scope: z.enum(COMPETITION_SCOPES).optional(),
  name: z.string().min(2).max(120).optional(),
  venue: z.string().max(120).optional(),
  entryDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export const createEntrySchema = z.object({
  riderId: z.string().min(1),
  className: z.string().min(1),
  horseId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  notes: z.string().max(300).optional(),
  // Override the horse-double-booking guard. Off by default so a manager has
  // to acknowledge the conflict explicitly.
  allowDoubleBook: z.boolean().optional(),
});

export const updateEntrySchema = z.object({
  status: z.enum(ENTRY_STATUSES).optional(),
  placement: z.coerce.number().int().min(1).max(50).optional().nullable(),
  score: z.coerce.number().min(-1000).max(1000).optional().nullable(),
  faults: z.coerce.number().min(0).max(1000).optional().nullable(),
  time: z.coerce.number().min(0).max(100000).optional().nullable(),
  teamId: z.string().optional().nullable(),
  paid: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});

export type CompetitionClass = z.infer<typeof competitionClassSchema>;
export type CreateCompetitionInput = z.infer<typeof createCompetitionSchema>;

// Accepts either a JSON string (legacy / tests) or a parsed JsonValue (native
// Postgres jsonb columns). Forgiving on bad shapes so a malformed row doesn't
// crash the competitions page.
export function parseClasses(json: unknown): CompetitionClass[] {
  if (json === null || json === undefined || json === "") return [];
  try {
    const v = typeof json === "string" ? JSON.parse(json) : json;
    const r = z.array(competitionClassSchema).safeParse(v);
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}
