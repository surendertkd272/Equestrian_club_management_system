import { z } from "zod";

export const CONSUMABLE_CATEGORIES = [
  "bandage",   // gauze pads, vet wrap, elastikon, cotton roll
  "dressing",  // non-stick pads, saline ampoules
  "hygiene",   // gloves, masks, hand sanitiser
  "tool",      // bandage scissors, thermometers (disposable variants)
  "other",
] as const;

export const CONSUMABLE_UNITS = ["each", "pad", "roll", "pack", "pair", "bottle", "ml", "g"] as const;

export const createConsumableSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(CONSUMABLE_CATEGORIES),
  unit: z.enum(CONSUMABLE_UNITS),
  qty: z.coerce.number().int().min(0).default(0),
  reorderThreshold: z.coerce.number().int().min(0).default(10),
  supplier: z.string().max(80).optional(),
  storageLocation: z.string().max(80).optional(),
  notes: z.string().max(300).optional(),
});

export const moveConsumableSchema = z.object({
  direction: z.enum(["in", "out", "adjust"]),
  qty: z.coerce.number().int().positive(),
  reason: z.string().max(200).optional(),
});

export type CreateConsumableInput = z.infer<typeof createConsumableSchema>;
export type MoveConsumableInput = z.infer<typeof moveConsumableSchema>;
