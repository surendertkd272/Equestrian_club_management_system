import { z } from "zod";

export const OWNER_ROLES = ["OWNER_ADMIN", "OWNER_EDITOR", "OWNER_BILLING"] as const;
export type OwnerRoleKey = (typeof OWNER_ROLES)[number];

export const inviteOwnerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
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
