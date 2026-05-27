import { z } from "zod";

// Club-level catalog data that used to be seeded-only (no UI). Now fully
// manageable: Fee Plans, Progress Levels, and Skills — all centre-scoped.

export const SKILL_DISCIPLINES = [
  "normal",
  "dressage",
  "jumping",
  "gymkhana",
  "tent_pegging",
  "endurance",
] as const;

export const createFeePlanSchema = z.object({
  levelName: z.string().min(1).max(60),
  monthlyAmount: z.coerce.number().min(0).max(10_000_000),
  registrationAmount: z.coerce.number().min(0).max(10_000_000),
});
export const updateFeePlanSchema = createFeePlanSchema.partial();

export const createProgressLevelSchema = z.object({
  name: z.string().min(1).max(60),
  order: z.coerce.number().int().min(0).max(1000),
});
export const updateProgressLevelSchema = createProgressLevelSchema.partial();

export const createSkillSchema = z.object({
  levelId: z.string().min(1),
  discipline: z.enum(SKILL_DISCIPLINES),
  name: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
});
export const updateSkillSchema = createSkillSchema.partial().omit({ levelId: true });

// Who can manage club catalog data: HQ tier + the club's own manager.
export function canManageCatalog(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "CENTRE_MANAGER";
}
