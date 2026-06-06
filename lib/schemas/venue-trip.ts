import { z } from "zod";

// Roles that run event logistics — shared by every venue-trip route so the
// permission set stays in one place (route.ts files shouldn't export extras).
export const CAN_MANAGE_TRIPS = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "STABLE_MANAGER",
]);

// Transport of horses + equipment to an event venue, with an inventory check
// OUT (before departure) and IN (on return) so anything lost or damaged at
// the venue is caught immediately.

export const TRIP_ITEM_CATEGORIES = [
  "horse",
  "tack",
  "feed",
  "equipment",
  "medical",
  "document",
  "other",
] as const;

export const createTripSchema = z.object({
  eventName: z.string().min(2).max(120),
  venue: z.string().min(2).max(160),
  departureAt: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "date or datetime"),
  notes: z.string().max(500).optional(),
});

export const addTripItemSchema = z.object({
  category: z.enum(TRIP_ITEM_CATEGORIES),
  label: z.string().min(1).max(120),
  qtyExpected: z.coerce.number().int().min(1).max(10000).default(1),
});

// Check OUT (loading) or IN (return). condition free-text: "ok" | "damaged" |
// "missing" | note. checkedIn with condition≠ok is what flags a loss/damage.
export const checkTripItemSchema = z.object({
  phase: z.enum(["out", "in"]),
  checked: z.boolean(),
  condition: z.string().max(200).optional(),
  remarks: z.string().max(300).optional(),
});

export const updateTripStatusSchema = z.object({
  status: z.enum(["planned", "departed", "returned", "cancelled"]),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;
