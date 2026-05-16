// Role lives at the application layer (SQLite doesn't support Prisma enums).
// Postgres swap: convert the `role` column to a native enum if desired.
export const ROLES = [
  "SUPER_ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
  "STABLE_MANAGER",
  "INVENTORY_MANAGER",
  "COMPETITION_MANAGER",
  "GROOM",
  "FARRIER",
  "VET",
  "ACCOUNTANT",
  "EXAMINER",
  // Sits on a panel for exams AND competitions. Distinct from EXAMINER:
  // - EXAMINER schedules + leads exams (can be a panel of one)
  // - JURY scores from the panel but doesn't schedule. Usually invited per
  //   event from another centre to keep judging independent.
  "JURY",
  "RIDER",
  "PARENT",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
