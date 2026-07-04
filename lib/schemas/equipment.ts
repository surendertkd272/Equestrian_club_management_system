import { z } from "zod";

// Sprint 3.5 categories — replaces the previous UK/Western split with
// the client's 7 categories from their PDF (Tack / Grooming / Farrier /
// Sports / Rider / Stable / Vet). Plus "other" for admin-added items
// that don't fit the canonical buckets.
//
// Display order matters — the inventory page groups by category and
// renders them in the order listed here (tack first, then grooming,
// then stable, then rider, then everything else). The page sorts by
// EQUIPMENT_CATEGORY_ORDER below rather than alphabetically so this
// order is what the admin actually sees.
export const EQUIPMENT_CATEGORIES = [
  "tack",
  "grooming",
  "stable",
  "rider",
  "farrier",
  "sports",
  "vet",
  "other",
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

// Index map for sorting catalog rows by category display order.
export const EQUIPMENT_CATEGORY_ORDER: Record<string, number> =
  Object.fromEntries(EQUIPMENT_CATEGORIES.map((c, i) => [c, i]));

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
  // Item photo — an /uploads/ URL from /api/upload (kind=asset_photo).
  // Null clears the photo.
  photoUrl: z
    .string()
    .regex(/^\/uploads\/[a-z0-9._-]+$/i, "Must be an /uploads/ URL")
    .nullable()
    .optional(),
  active: z.boolean().default(true),
});

export const updateCatalogSchema = createCatalogSchema.partial();

// Inventory update from a centre. Either set an absolute qty or apply a
// delta (positive = restock, negative = consumption). Threshold override
// is independent.
export const updateStockSchema = z
  .object({
    // Legacy qty (= unused + in-use) is still accepted for back-compat,
    // but the four condition-state columns are the new source of truth.
    qty: z.coerce.number().int().min(0).max(1_000_000).optional(),
    delta: z.coerce.number().int().min(-100_000).max(100_000).optional(),
    qtyUnused: z.coerce.number().int().min(0).max(1_000_000).optional(),
    qtyInUse: z.coerce.number().int().min(0).max(1_000_000).optional(),
    qtyForRepair: z.coerce.number().int().min(0).max(1_000_000).optional(),
    qtyDamaged: z.coerce.number().int().min(0).max(1_000_000).optional(),
    newRequired: z.coerce.number().int().min(0).max(1_000_000).optional(),
    owner: z.string().max(120).nullable().optional(),
    threshold: z.coerce.number().int().min(0).max(10_000).nullable().optional(),
    reason: z.enum(["restock", "consumed", "lost", "damaged", "adjustment", "initial"]).default("adjustment"),
    notes: z.string().max(300).nullable().optional(),
  })
  .refine(
    (d) =>
      d.qty !== undefined ||
      d.delta !== undefined ||
      d.qtyUnused !== undefined ||
      d.qtyInUse !== undefined ||
      d.qtyForRepair !== undefined ||
      d.qtyDamaged !== undefined ||
      d.newRequired !== undefined ||
      d.owner !== undefined ||
      d.threshold !== undefined ||
      d.notes !== undefined,
    { message: "Provide at least one field to update." },
  );
