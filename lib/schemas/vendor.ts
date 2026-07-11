import { z } from "zod";

// Sprint 3.6 — categories aligned with the client's 5 registration types.
// Tack + medical_supply rolled into equipment_gear (the client doesn't
// separate riding tack from arena equipment in their procurement flow).
// Fodder + hay both live under `feed` per scope confirmation.
export const VENDOR_CATEGORIES = [
  "vet",
  "farrier",
  "horse_ambulance",
  "truck",
  "feed",
  "equipment_gear",
  "other",
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

// Public vendor self-registration (/onboard/vendor?centre=<slug>). Deliberately
// a lean subset of the admin create schema — no bank/UPI details or delivery
// scope (those are set by the admin on approval). Phone is required so the club
// can follow up. The row is created status="pending" for admin review.
export const publicVendorRegistrationSchema = z.object({
  centreSlug: z.string().min(1),
  name: z.string().min(2).max(120),
  category: z.enum(VENDOR_CATEGORIES).optional(),
  contactName: z.string().max(80).optional().or(z.literal("")).transform((v) => v || undefined),
  phone: z.string().min(7).max(40),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  address: z.string().max(300).optional().or(z.literal("")).transform((v) => v || undefined),
  gstin: z.string().max(30).optional().or(z.literal("")).transform((v) => v || undefined),
  notes: z.string().max(500).optional().or(z.literal("")).transform((v) => v || undefined),
});
export type PublicVendorRegistrationInput = z.infer<typeof publicVendorRegistrationSchema>;

export const VENDOR_CATEGORY_LABEL: Record<VendorCategory, string> = {
  vet: "Vet doctor",
  farrier: "Farrier",
  horse_ambulance: "Horse ambulance",
  truck: "Truck / transport",
  feed: "Feed (fodder & hay)",
  equipment_gear: "Equipment & gear",
  other: "Other",
};

// ─────────────────────────────────────────────────────────────────────────
// Category-specific extra fields stored in Vendor.categorySpecificJson.
// Each shape below is the canonical JSON contract; the form variant in
// vendors/form.tsx renders the matching input fields, the row display
// reads them out. Unknown keys are preserved on update so a future field
// addition doesn't lose past data.

export const VET_FIELDS_SCHEMA = z.object({
  vciNumber: z.string().max(60).optional(),
  qualification: z.string().max(40).optional(),
  specialty: z.string().max(40).optional(),
  yearsPractice: z.coerce.number().int().min(0).max(80).optional(),
  emergencyAvailable: z.boolean().optional(),
  clinicAffiliation: z.string().max(200).optional(),
});

export const FARRIER_FIELDS_SCHEMA = z.object({
  yearsExperience: z.coerce.number().int().min(0).max(80).optional(),
  specialisations: z.array(z.string().max(40)).optional(),
  availableDays: z.array(z.string().max(10)).optional(),
  carriesForge: z.boolean().optional(),
  hourlyRate: z.coerce.number().nonnegative().max(100_000).optional(),
});

// Picklists used by the form UI. Centralised here so future additions
// only need a single edit.
export const VET_QUALIFICATIONS = ["BVSc", "BVSc & AH", "MVSc", "PhD", "Other"] as const;
export const VET_SPECIALTIES = [
  "general",
  "equine",
  "surgery",
  "sports_medicine",
  "reproduction",
] as const;
export const FARRIER_SPECIALISATIONS = [
  "cold_shoeing",
  "hot_shoeing",
  "corrective",
  "racing",
  "barefoot_trim",
] as const;
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// NOTE: app/api/vendors/route.ts uses createVendorSchema from
// @/lib/schemas/finance — not this one. This schema below is kept as
// reference for the canonical vendor field set but isn't the one
// validating live requests. If you add fields, mirror them in the
// finance schema too.
export const createVendorSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.enum(VENDOR_CATEGORIES).default("other"),
  contactName: z.string().max(120).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(300).optional(),
  gstin: z.string().max(20).optional(),
  notes: z.string().max(500).optional(),
  centreId: z.string().min(1),
  categorySpecific: z.record(z.any()).optional(),
});

export const updateVendorSchema = createVendorSchema.partial().extend({
  active: z.boolean().optional(),
});

export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
