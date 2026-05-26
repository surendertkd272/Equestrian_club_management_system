import { z } from "zod";

export const HORSE_STATUSES = ["active", "rest", "retired"] as const;
export const HORSE_SEXES = ["mare", "gelding", "stallion"] as const;
export const HORSE_OWNERSHIPS = ["club", "private"] as const;

// Default daily workload cap (minutes). Per §4.13 the spec uses ~4 hours.
export const DEFAULT_WORKLOAD_CAP_MIN = 240;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required");

export const createHorseSchema = z.object({
  name: z.string().min(1).max(40),
  breed: z.string().max(40).optional(),
  sex: z.enum(HORSE_SEXES).optional(),
  ageYears: z.coerce.number().int().min(0).max(50).optional(),
  heightHh: z.coerce.number().min(8).max(20).optional(),
  microchip: z.string().max(40).optional(),
  // EFI horse registration id (optional — only competing horses have one)
  efiHorseId: z.string().max(40).optional(),
  // Free-text label for the horse's home club when stabling temporarily
  // at an Equiwings centre (visiting / private horses).
  homeClub: z.string().max(80).optional(),
  ownership: z.enum(HORSE_OWNERSHIPS).default("club"),
  stableNo: z.string().max(20).optional(),
  diet: z.string().max(200).optional(),
  // PDF §4 — Insurance Records. All optional; pass "" or omit to clear.
  insurerName: z.string().max(100).optional(),
  insurancePolicyNo: z.string().max(60).optional(),
  insurancePremium: z.coerce.number().nonnegative().optional(),
  insuranceValidFrom: ymd.optional().or(z.literal("")),
  insuranceValidTo: ymd.optional().or(z.literal("")),
});

export const updateHorseSchema = createHorseSchema.partial().extend({
  status: z.enum(HORSE_STATUSES).optional(),
});

export const ALLOCATION_PURPOSES = ["lesson", "exam", "competition", "training", "exercise"] as const;

export const createAllocationSchema = z.object({
  riderId: z.string().min(1).nullable().optional(),
  purpose: z.enum(ALLOCATION_PURPOSES),
  startAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Local datetime")),
  endAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Local datetime")),
});

export type CreateHorseInput = z.infer<typeof createHorseSchema>;
export type CreateAllocationInput = z.infer<typeof createAllocationSchema>;
