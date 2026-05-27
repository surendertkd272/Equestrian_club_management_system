import { z } from "zod";

export const VENDOR_CATEGORIES = [
  "vet",
  "farrier",
  "horse_ambulance",
  "truck",
  "feed",
  "tack",
  "medical_supply",
  "other",
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const VENDOR_CATEGORY_LABEL: Record<VendorCategory, string> = {
  vet: "Vet doctor",
  farrier: "Farrier",
  horse_ambulance: "Horse ambulance",
  truck: "Truck / transport",
  feed: "Feed supplier",
  tack: "Tack supplier",
  medical_supply: "Medical supply",
  other: "Other",
};

export const createVendorSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.enum(VENDOR_CATEGORIES).default("other"),
  contactName: z.string().max(120).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(300).optional(),
  gstin: z.string().max(20).optional(),
  notes: z.string().max(500).optional(),
  // Super admin / admin picks which centre owns the vendor entry.
  centreId: z.string().min(1),
});

export const updateVendorSchema = createVendorSchema.partial().extend({
  active: z.boolean().optional(),
});

export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
