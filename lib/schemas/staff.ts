import { z } from "zod";
import { ROLES } from "@/lib/roles";

const STAFF_ROLES = ROLES.filter((r) => r !== "SUPER_ADMIN" && r !== "RIDER") as readonly string[];

export const createStaffSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().min(10).max(20).optional().or(z.literal("")),
  role: z.string().refine((r) => STAFF_ROLES.includes(r), "Invalid staff role"),
  salaryBand: z.string().optional(),
  password: z.string().min(8, "8+ chars").default("password123"),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const ASSIGNABLE_STAFF_ROLES = STAFF_ROLES;
