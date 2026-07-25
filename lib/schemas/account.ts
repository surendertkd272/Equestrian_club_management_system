import { z } from "zod";
import { storedUrl } from "@/lib/schemas/url";

export const updateProfileSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    phone: z.string().max(40).nullable().optional(),
    photoUrl: storedUrl.nullable().optional(),
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

// Self-service login-email change. Request step re-authenticates with the
// current password (session alone isn't enough for a login-credential change),
// then a 6-digit code goes to the new address; confirm step redeems it.
export const requestEmailChangeSchema = z
  .object({
    newEmail: z.string().email().max(200),
    currentPassword: z.string().min(1),
  })
  .strict();

export const confirmEmailChangeSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeSchema>;
export type ConfirmEmailChangeInput = z.infer<typeof confirmEmailChangeSchema>;
