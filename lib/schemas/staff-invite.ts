import { z } from "zod";

// Roles a new hire can be invited as. Mirrors the public staff-register
// form's options. (HEAD_COACH included — senior hires use the same flow.)
export const STAFF_INVITE_ROLES = [
  "HEAD_COACH",
  "COACH",
  "GROOM",
  "STABLE_MANAGER",
  "INVENTORY_MANAGER",
  "VET",
  "FARRIER",
  "ACCOUNTANT",
  "COMPETITION_MANAGER",
  "EXAMINER",
] as const;

export const STAFF_INVITE_ROLE_LABEL: Record<string, string> = {
  HEAD_COACH: "Head Coach",
  COACH: "Coach",
  GROOM: "Groom",
  STABLE_MANAGER: "Stable Manager",
  INVENTORY_MANAGER: "Inventory Manager",
  VET: "Vet",
  FARRIER: "Farrier",
  ACCOUNTANT: "Accountant",
  COMPETITION_MANAGER: "Competition Manager",
  EXAMINER: "Examiner",
};

// Create a one-person, single-use staff invite.
//
// Email is optional — when supplied, the invite is email-locked (the
// public staff-register page rejects mismatches). When omitted, the
// invite is single-use only and the link must be shared manually
// (WhatsApp / SMS / in-person). The admin gets the URL back in the
// API response either way.
export const createStaffInviteSchema = z.object({
  email: z.string().email().optional().or(z.literal("")),
  name: z.string().max(80).optional(),
  role: z.enum(STAFF_INVITE_ROLES),
  expiresInDays: z.coerce.number().int().min(1).max(90).default(14),
});

export type CreateStaffInviteInput = z.infer<typeof createStaffInviteSchema>;
