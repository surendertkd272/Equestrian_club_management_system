import { z } from "zod";

export const EQUIPMENT_CATEGORIES = [
  "saddlery",
  "bridlery",
  "protection",
  "rider",
  "stable",
  "grooming",
  "feed",
  "tackroom",
  "arena",
  "vet",
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_UNITS = ["piece", "pair", "set", "metre", "kg", "litre"] as const;

export const createCatalogSchema = z.object({
  category: z.enum(EQUIPMENT_CATEGORIES),
  name: z.string().min(2).max(80),
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9_-]*[a-z0-9]$/, "lowercase letters, digits, _ and - only"),
  unit: z.enum(EQUIPMENT_UNITS).default("piece"),
  defaultThreshold: z.coerce.number().int().min(0).max(10000).default(5),
  notes: z.string().max(500).optional(),
  active: z.boolean().default(true),
});

export const updateCatalogSchema = createCatalogSchema.partial();

// Inventory update from a centre. Either set an absolute qty or apply a
// delta (positive = restock, negative = consumption). Threshold override
// is independent.
export const updateStockSchema = z
  .object({
    qty: z.coerce.number().int().min(0).max(1_000_000).optional(),
    delta: z.coerce.number().int().min(-100_000).max(100_000).optional(),
    threshold: z.coerce.number().int().min(0).max(10_000).nullable().optional(),
    reason: z.enum(["restock", "consumed", "lost", "damaged", "adjustment", "initial"]).default("adjustment"),
    notes: z.string().max(300).optional(),
  })
  .refine((d) => d.qty !== undefined || d.delta !== undefined || d.threshold !== undefined, {
    message: "Provide qty, delta, or threshold.",
  });
