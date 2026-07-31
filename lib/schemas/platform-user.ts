import { z } from "zod";
import { emailIdentity } from "@/lib/email-normalize";

export const OWNER_ROLES = ["OWNER_ADMIN", "OWNER_EDITOR", "OWNER_BILLING"] as const;
export type OwnerRoleKey = (typeof OWNER_ROLES)[number];

export const inviteOwnerSchema = z.object({
  name: z.string().min(2).max(120),
  email: emailIdentity(),
  role: z.enum(OWNER_ROLES),
});

export const updateOwnerSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    role: z.enum(OWNER_ROLES).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .strict();

export type InviteOwnerInput = z.infer<typeof inviteOwnerSchema>;
export type UpdateOwnerInput = z.infer<typeof updateOwnerSchema>;
