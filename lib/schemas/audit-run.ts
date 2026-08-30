import { z } from "zod";

export const AUDIT_SCOPES = ["inventory", "vet_inventory", "stable", "full"] as const;
export const AUDIT_RESULTS = ["pass", "fail", "na", "pending"] as const;

// Who can run a manual inspection. INSPECTION_OFFICER is the external auditor;
// admins + centre manager can also run one. Shared by every inspection route.
export const CAN_INSPECT = new Set(["INSPECTION_OFFICER", "SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"]);

export const startAuditSchema = z.object({
  scope: z.enum(AUDIT_SCOPES),
});

export const markAuditItemSchema = z.object({
  result: z.enum(AUDIT_RESULTS),
  remarks: z.string().max(300).optional(),
  // What was actually on the shelf, for inventory lines. Nullable so a line
  // can be cleared, and coerced because a number input hands back a string.
  counted: z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
});

export const completeAuditSchema = z.object({
  summary: z.string().max(1000).optional(),
});

// Default checklist lines seeded when an inspection starts, by scope. Mirrors
// the paper SOP audit sheet so the inspector has a ready list to walk.
export const AUDIT_TEMPLATES: Record<string, { area: string; label: string }[]> = {
  inventory: [
    { area: "Tack room", label: "Saddles present & accounted for" },
    { area: "Tack room", label: "Bridles & bits counted vs register" },
    { area: "Grooming", label: "Grooming kits complete" },
    { area: "Rider gear", label: "Helmets & body protectors serviceable" },
    { area: "Stable equipment", label: "Rugs / fly sheets counted" },
    { area: "Farrier tools", label: "Farrier kit present" },
  ],
  vet_inventory: [
    { area: "Vet cabinet", label: "Emergency medicines in stock" },
    { area: "Vet cabinet", label: "No expired medicines on shelf" },
    { area: "Cold chain", label: "Vaccines stored at correct temperature" },
    { area: "First aid", label: "First-aid consumables stocked" },
    { area: "Records", label: "Medicine usage log up to date" },
    { area: "Controlled", label: "Sedatives secured & logged" },
  ],
  stable: [
    { area: "Stables", label: "Stalls clean & mucked out" },
    { area: "Water", label: "Water troughs clean & full" },
    { area: "Feed store", label: "Feed store clean & pest-free" },
    { area: "Bedding", label: "Adequate bedding stock" },
    { area: "Safety", label: "Fire extinguishers in date" },
    { area: "Safety", label: "Exits & walkways clear" },
  ],
  full: [
    { area: "Tack room", label: "Tack counted vs register" },
    { area: "Rider gear", label: "Helmets & body protectors serviceable" },
    { area: "Vet cabinet", label: "Emergency medicines in stock, none expired" },
    { area: "Cold chain", label: "Vaccines stored correctly" },
    { area: "Stables", label: "Stalls clean & mucked out" },
    { area: "Feed store", label: "Feed store clean & pest-free" },
    { area: "Safety", label: "Fire extinguishers in date, exits clear" },
    { area: "Records", label: "Daily checklists & logs maintained" },
  ],
};

export type StartAuditInput = z.infer<typeof startAuditSchema>;
