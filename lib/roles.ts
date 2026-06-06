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
  "GROOM",
  "FARRIER",
  "VET",
  "ACCOUNTANT",
  "EXAMINER",
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

// Read-only roles — see data, can't mutate anything. SCHOOL_ADMINISTRATOR
// is a partner-school's oversight account (sees a club's students); future
// view-only roles get added here so every "hide edit UI" check has one
// source of truth.
//
// Important: this is a UI-hiding helper. The actual write block lives at
// the API layer — SCHOOL_ADMINISTRATOR is deliberately absent from every
// can() permission in lib/permissions.ts. isReadOnly() is "don't render
// the button"; the can() check is "refuse if they tried anyway."
export const READ_ONLY_ROLES: readonly Role[] = ["SCHOOL_ADMINISTRATOR"];

export function isReadOnly(role: Role): boolean {
  return READ_ONLY_ROLES.includes(role);
}
