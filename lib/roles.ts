// Role lives at the application layer (SQLite doesn't support Prisma enums).
// Postgres swap: convert the `role` column to a native enum if desired.
export const ROLES = [
  // HQ tier — cross-club visibility.
  "SUPER_ADMIN",
  // ADMIN is a peer of SUPER_ADMIN with cross-club visibility + write
  // access on data, but without the ability to manage other HQ users,
  // suspend tenants, or write the audit log. Designed for a single
  // delegated operator (one ADMIN account, one SUPER_ADMIN account).
  "ADMIN",
  // Club tier — one centre's scope.
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
  // External / read-only roles.
  // SCHOOL_ADMINISTRATOR sees one club's riders' attendance, exams, skills —
  // designed for schools partnered with a club that want oversight of
  // their students' progress without operational write access.
  "SCHOOL_ADMINISTRATOR",
  // INSPECTION_OFFICER is an external auditor scoped to a single centre,
  // marks inventory + vet inventory pass/fail with remarks. No other writes.
  "INSPECTION_OFFICER",
  "RIDER",
  "PARENT",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
