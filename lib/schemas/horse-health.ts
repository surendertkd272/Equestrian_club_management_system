import { z } from "zod";

// PDF §4 — Horse Temperature Chart. Normal equine vitals at rest:
//   temp:  37.2 – 38.3 °C   (anything > 39 = fever, < 36.5 = hypothermia)
//   HR:    28 – 44 bpm
//   resp:  8 – 16 rpm
// We validate generously and let the chart UI flag outliers visually.

export const APPETITE_OPTIONS = ["good", "reduced", "none"] as const;
export const MANURE_OPTIONS = ["normal", "dry", "loose", "watery", "none"] as const;

export const createHealthLogSchema = z.object({
  horseId: z.string().min(1),
  recordedAt: z.string().datetime().optional(), // server fills with now() if omitted
  tempC: z.coerce.number().min(30).max(45).optional(),
  heartRateBpm: z.coerce.number().int().min(10).max(200).optional(),
  respirationRpm: z.coerce.number().int().min(1).max(80).optional(),
  weightKg: z.coerce.number().positive().max(2000).optional(),
  appetite: z.enum(APPETITE_OPTIONS).optional(),
  manure: z.enum(MANURE_OPTIONS).optional(),
  notes: z.string().max(500).optional(),
});

export type CreateHealthLogInput = z.infer<typeof createHealthLogSchema>;

// Out-of-range flags used by the chart UI.
export function tempFlag(t: number | null | undefined): "low" | "high" | "ok" | undefined {
  if (t == null) return undefined;
  if (t < 36.5) return "low";
  if (t > 39) return "high";
  return "ok";
}

export function hrFlag(hr: number | null | undefined): "low" | "high" | "ok" | undefined {
  if (hr == null) return undefined;
  if (hr < 28) return "low";
  if (hr > 60) return "high";
  return "ok";
}
