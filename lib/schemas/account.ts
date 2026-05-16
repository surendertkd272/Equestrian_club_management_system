import { z } from "zod";

export const updateProfileSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    phone: z.string().max(40).nullable().optional(),
    photoUrl: z.string().url().nullable().optional(),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    // 8+ chars feels right for a club CMS — long enough to thwart hand-guessing,
    // short enough not to push users into reuse.
    newPassword: z.string().min(8).max(200),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
