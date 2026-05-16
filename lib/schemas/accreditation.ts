import { z } from "zod";

const dateLike = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createAccreditationSchema = z.object({
  riderId: z.string().min(1),
  body: z.string().min(2).max(80),
  title: z.string().min(2).max(120),
  discipline: z.string().max(40).optional(),
  level: z.string().max(40).optional(),
  serialNo: z.string().max(60).optional(),
  issuedAt: dateLike,
  expiresAt: dateLike.optional(),
  fileUrl: z.string().url().optional(),
  notes: z.string().max(500).optional(),
});

export const updateAccreditationSchema = z.object({
  body: z.string().min(2).max(80).optional(),
  title: z.string().min(2).max(120).optional(),
  discipline: z.string().max(40).nullable().optional(),
  level: z.string().max(40).nullable().optional(),
  serialNo: z.string().max(60).nullable().optional(),
  issuedAt: dateLike.optional(),
  expiresAt: dateLike.nullable().optional(),
  fileUrl: z.string().url().nullable().optional(),
  status: z.enum(["active", "expired", "revoked"]).optional(),
  notes: z.string().max(500).nullable().optional(),
});
