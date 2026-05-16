import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const ASSET_CATEGORIES = ["tack", "school_equipment"] as const;
export const ASSET_STATUSES = ["new", "in_use", "repair", "retired"] as const;
export const RETURN_CONDITIONS = ["good", "damaged", "lost"] as const;

export const TACK_SUBCATEGORIES = [
  "saddle",
  "bridle",
  "helmet",
  "boots",
  "gloves",
  "girth",
  "stirrup_leather",
  "saddle_pad",
  "lunge_line",
  "halter",
  "other",
] as const;

export const SCHOOL_SUBCATEGORIES = [
  "show_jump",
  "dressage_arena",
  "trophy",
  "banner",
  "uniform",
  "tent",
  "barrier",
  "other",
] as const;

export const createAssetSchema = z.object({
  category: z.enum(ASSET_CATEGORIES),
  subcategory: z.string().max(40).optional(),
  name: z.string().min(2).max(80),
  brand: z.string().max(40).optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cost: z.coerce.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export const updateAssetSchema = createAssetSchema.partial().extend({
  status: z.enum(ASSET_STATUSES).optional(),
});

export const issueAssetSchema = z
  .object({
    issuedToUserId: z.string().min(1).optional(),
    issuedToRiderId: z.string().min(1).optional(),
    issuedToHorseId: z.string().min(1).optional(),
    note: z.string().max(200).optional(),
  })
  .refine(
    (d) => Boolean(d.issuedToUserId) || Boolean(d.issuedToRiderId) || Boolean(d.issuedToHorseId),
    "Pick a rider, staff member, or horse to issue to.",
  );

export const returnAssetSchema = z.object({
  conditionAtReturn: z.enum(RETURN_CONDITIONS),
  note: z.string().max(200).optional(),
});

export const createMaintenanceSchema = z.object({
  issue: z.string().min(2).max(200),
  vendor: z.string().max(80).optional(),
  cost: z.coerce.number().min(0).optional(),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Human-readable scan codes. Avoid ambiguous chars (0/O/1/I) so handwritten copies survive.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomChunk(n: number): string {
  let out = "";
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

export async function generateAssetCode(category: (typeof ASSET_CATEGORIES)[number]): Promise<string> {
  const prefix = category === "tack" ? "EW-TACK-" : "EW-EQ-";
  for (let i = 0; i < 8; i++) {
    const candidate = prefix + randomChunk(6);
    const existing = await prisma.asset.findUnique({ where: { qrCode: candidate } });
    if (!existing) return candidate;
  }
  throw new Error("Could not allocate unique asset code after 8 attempts");
}
