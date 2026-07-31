import { z } from "zod";
import { emailIdentity } from "@/lib/email-normalize";

export const RELATIONSHIPS = ["father", "mother", "guardian"] as const;

// Two creation modes:
//  - parentUserId — link an existing PARENT user account
//  - parent: { name, email, phone? } — create the user account inline and link it
// The route enforces exactly one of the two is provided.
export const createParentLinkSchema = z
  .object({
    parentUserId: z.string().min(1).optional(),
    relationship: z.enum(RELATIONSHIPS),
    parent: z
      .object({
        name: z.string().min(2).max(120),
        email: emailIdentity(),
        phone: z.string().optional(),
      })
      .optional(),
  })
  .refine((d) => Boolean(d.parentUserId) !== Boolean(d.parent), {
    message: "Either link an existing parent account or enter new parent details — not both.",
    path: ["parentUserId"],
  });

export type CreateParentLinkInput = z.infer<typeof createParentLinkSchema>;
