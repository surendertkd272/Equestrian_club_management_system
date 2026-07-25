import { z } from "zod";
import { ROLES } from "@/lib/roles";
import { optionalStoredUrl } from "@/lib/schemas/url";

export const createCourseSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  targetRoles: z.array(z.enum(ROLES)).max(14).optional(),
  durationHrs: z.coerce.number().int().min(1).max(500).optional(),
  passingMark: z.coerce.number().int().min(0).max(100).optional(),
});

export const enrolSchema = z.object({
  userId: z.string().min(1),
});

export const finishEnrolmentSchema = z.object({
  finalMark: z.coerce.number().int().min(0).max(100).optional(),
  status: z.enum(["completed", "dropped"]),
});

// Issuing an external certification (no Course backing) requires title + issuer.
export const issueCertSchema = z.object({
  userId: z.string().min(1),
  courseId: z.string().nullable().optional(),
  title: z.string().min(1).max(120),
  issuer: z.string().max(120).optional(),
  serialNo: z.string().max(80).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fileUrl: optionalStoredUrl,
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type IssueCertInput = z.infer<typeof issueCertSchema>;
