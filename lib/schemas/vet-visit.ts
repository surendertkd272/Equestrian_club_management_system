import { z } from "zod";

// One prescribed med within a visit. `medicineId` is optional — vets may
// prescribe something not currently stocked (the centre will need to order
// it) or write a free-text instruction. `medicineName` is always required
// so we always have a human label even when the inventory row is later
// deleted.
export const vetPrescriptionSchema = z.object({
  medicineId: z.string().min(1).nullable().optional(),
  medicineName: z.string().min(1).max(200),
  dose: z.string().min(1).max(80),
  route: z.enum(["oral", "im", "iv", "topical"]).nullable().optional(),
  durationDays: z.number().int().positive().max(365).nullable().optional(),
  frequency: z.string().max(80).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const createVetVisitSchema = z.object({
  visitDate: z.string().datetime().optional(),
  reason: z.string().max(200).nullable().optional(),
  notes: z.string().min(1, "Notes are required").max(5000),
  followUpAt: z.string().datetime().nullable().optional(),
  prescriptions: z.array(vetPrescriptionSchema).max(20).default([]),
});

export type CreateVetVisitInput = z.infer<typeof createVetVisitSchema>;
export type VetPrescriptionInput = z.infer<typeof vetPrescriptionSchema>;
