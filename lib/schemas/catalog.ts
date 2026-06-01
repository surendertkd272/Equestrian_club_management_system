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
  // After the rubric migration, 'discipline' became a free-form category
  // string — driven by the exam rubric's section names (Dress Code,
  // Know Your Horse, Parts of Saddle / Tack, Riding Knowledge, Overall
  // Judgement). Per-tenant rename-able. Old enum values (normal /
  // dressage / jumping / etc.) still pass since they're just strings.
  discipline: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
});
export const updateSkillSchema = createSkillSchema.partial().omit({ levelId: true });

// Who can manage club catalog data: HQ tier + the club's own manager.
export function canManageCatalog(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "CENTRE_MANAGER";
}
