import { z } from "zod";

export const EVENT_TYPES = [
  "clinic",
  "schooling",
  "demo",
  "parent_day",
  "fundraiser",
  "external_show",
  "camp",
  "open_house",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = ["draft", "open", "live", "completed", "cancelled"] as const;
export const REGISTRATION_STATUSES = ["registered", "attended", "no_show", "cancelled"] as const;

const dateLike = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/);

export const createEventSchema = z
  .object({
    title: z.string().min(2).max(120),
    type: z.enum(EVENT_TYPES),
    description: z.string().max(2000).optional(),
    externalVenue: z.string().max(120).optional(),
    externalHostOrg: z.string().max(120).optional(),
    startDate: dateLike,
    endDate: dateLike,
    fee: z.coerce.number().min(0).max(1_000_000).default(0),
    capacity: z.coerce.number().int().min(1).max(10_000).optional(),
    isPublic: z.boolean().default(false),
    slug: z
      .string()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "lowercase letters, digits and hyphens only")
      .optional(),
    contactName: z.string().max(80).optional(),
    contactPhone: z.string().max(40).optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: "endDate must be on/after startDate",
    path: ["endDate"],
  });

export const updateEventSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  type: z.enum(EVENT_TYPES).optional(),
  description: z.string().max(2000).nullable().optional(),
  externalVenue: z.string().max(120).nullable().optional(),
  externalHostOrg: z.string().max(120).nullable().optional(),
  startDate: dateLike.optional(),
  endDate: dateLike.optional(),
  fee: z.coerce.number().min(0).optional(),
  capacity: z.coerce.number().int().min(1).nullable().optional(),
  isPublic: z.boolean().optional(),
  status: z.enum(EVENT_STATUSES).optional(),
  contactName: z.string().max(80).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const createRegistrationSchema = z.object({
  riderId: z.string().min(1),
  notes: z.string().max(300).optional(),
});

export const updateRegistrationSchema = z.object({
  status: z.enum(REGISTRATION_STATUSES).optional(),
  paid: z.boolean().optional(),
  notes: z.string().max(300).nullable().optional(),
});
