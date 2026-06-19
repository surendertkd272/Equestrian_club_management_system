import type { Role } from "./roles";

export type Permission =
  | "centre.manage"
  | "rider.read"
  | "rider.write"
  | "rider.onboard"
  | "attendance.mark"
  | "progress.write"
  | "assessment.score"
  | "exam.schedule"
  | "exam.score"
  | "exam.template_edit"
  | "staff.manage"
  | "staff.attendance"
  | "leave.request"
  | "leave.approve"
  | "task.assign"
  | "task.complete"
  | "asset.manage"
  | "medicine.manage"
  | "medicine.prescribe"
  | "horse.manage"
  | "event.manage"
  | "expense.manage"
  | "expense.submit"
  | "requisition.submit"
  | "requisition.approve_manager"
  | "requisition.approve_accountant"
  | "accreditation.manage"
  | "team.manage"
  | "finance.read"
  | "finance.write"
  | "certificate.issue"
  | "certificate.bulk"
  | "audit.read"
  // Day-to-day lesson operations (delete a wrong session, eventually:
  // create/update too). Granted to roles that actually run lessons —
  // not the same as staff.manage, which is about managing staff records.
  | "lesson.write"
  // Create / delete batches (recurring class slots). Deliberately split out
  // from staff.manage: staff.manage gates staff USER-ACCOUNT creation
  // (POST /api/staff, onboarding approval, cert issuance), so coaches must
  // NOT get it — that would be a privilege-escalation hole. Managing the
  // training roster is a separate, coach-appropriate concern.
  | "batch.manage";

const matrix: Record<Role, Permission[]> = {
  SUPER_ADMIN: [
    "centre.manage", "rider.read", "rider.write", "rider.onboard", "attendance.mark",
    "progress.write", "assessment.score", "exam.schedule", "exam.score", "exam.template_edit",
    "staff.manage", "staff.attendance", "leave.request", "leave.approve",
    "task.assign", "task.complete", "asset.manage",
    "medicine.manage", "medicine.prescribe", "horse.manage",     "event.manage", "expense.manage", "expense.submit", "accreditation.manage", "team.manage",
    "finance.read", "finance.write", "certificate.issue", "certificate.bulk", "audit.read",
    "requisition.submit", "requisition.approve_manager", "requisition.approve_accountant",
    "lesson.write", "batch.manage",
  ],
  CENTRE_MANAGER: [
    "rider.read", "rider.write", "rider.onboard", "attendance.mark", "progress.write",
    "exam.schedule", "exam.score",
    "staff.manage", "staff.attendance", "leave.request", "leave.approve",
    "task.assign", "task.complete", "asset.manage", "medicine.manage", "horse.manage",     "event.manage", "expense.manage", "expense.submit", "accreditation.manage", "team.manage",
    "finance.read", "finance.write", "certificate.issue", "certificate.bulk",
    "requisition.submit", "requisition.approve_manager", "requisition.approve_accountant",
    "lesson.write", "batch.manage",
  ],
  HEAD_COACH: [
    // Senior trainer — broader than a regular coach. Can schedule exams and supervise other coaches'
    // task assignments. Doesn't touch finance or asset inventory.
    "rider.read", "rider.write", "attendance.mark", "progress.write",
    "exam.schedule", "exam.score", "assessment.score",
    "staff.attendance", "leave.request", "leave.approve",
    "task.assign", "task.complete", "horse.manage", "expense.submit", "team.manage",
    "requisition.submit", "requisition.approve_manager",
    "lesson.write", "batch.manage",
  ],
  COACH: ["rider.read", "attendance.mark", "progress.write", "task.complete", "leave.request", "expense.submit", "requisition.submit", "lesson.write", "batch.manage"],
  STABLE_MANAGER: [
    // Owns the stable + horse roster + the tack/grooming kit needed for daily ops.
    "horse.manage", "asset.manage", "task.assign", "task.complete",
    "staff.attendance", "leave.request", "leave.approve", "expense.submit",
    "requisition.submit", "requisition.approve_manager",
  ],
  INVENTORY_MANAGER: [
    // Tack, school equipment, medicine inventory (stock side — vet still prescribes).
    "asset.manage", "medicine.manage", "task.complete", "leave.request", "expense.submit",
    "requisition.submit",
  ],
  GROOM: ["task.assign", "task.complete", "asset.manage", "leave.request", "expense.submit", "requisition.submit"],
  FARRIER: [
    // Specialist labour — logs shoeing tasks against horses; otherwise read-only.
    "horse.manage", "task.complete", "leave.request", "expense.submit", "requisition.submit",
  ],
  VET: ["medicine.manage", "medicine.prescribe", "horse.manage", "task.complete", "leave.request", "expense.submit", "requisition.submit"],
  ACCOUNTANT: [
    "medicine.manage", "finance.read", "finance.write", "expense.manage", "expense.submit", "leave.request",
    "requisition.submit", "requisition.approve_accountant",
  ],
  EXAMINER: ["rider.read", "assessment.score", "exam.score", "certificate.issue", "leave.request"],
  // ADMIN — HQ-wide delegate of SUPER_ADMIN. Same operational perms minus
  // the HQ-only powers (managing other HQ users, suspending tenants,
  // writing audit). The page-level guards on /audit and /centres/[id]/
  // suspension also re-check role === "SUPER_ADMIN" for those specific
  // actions; this matrix grants ADMIN everything else SUPER_ADMIN has.
  ADMIN: [
    "centre.manage", "rider.read", "rider.write", "rider.onboard", "attendance.mark",
    "progress.write", "assessment.score", "exam.schedule", "exam.score", "exam.template_edit",
    "staff.manage", "staff.attendance", "leave.request", "leave.approve",
    "task.assign", "task.complete", "asset.manage",
    "medicine.manage", "medicine.prescribe", "horse.manage",     "event.manage", "expense.manage", "expense.submit", "accreditation.manage", "team.manage",
    "finance.read", "finance.write", "certificate.issue", "certificate.bulk",
    "requisition.submit", "requisition.approve_manager", "requisition.approve_accountant",
    "lesson.write", "batch.manage",
    // Note: no "audit.read" — ADMIN gets read-only audit access via a
    // role check at /audit, but doesn't carry the global perm. Keeps the
    // permission matrix the source of truth for write-side actions.
  ],
  // SCHOOL_ADMINISTRATOR — read-only oversight of one club's riders.
  // Sees attendance, exam levels, skills. No write access anywhere.
  SCHOOL_ADMINISTRATOR: ["rider.read"],
  // INSPECTION_OFFICER — external auditor, scoped to one centre. The
  // audit-write permission is currently a placeholder; real audit-run
  // write logic lives in /api/audit-runs and re-checks role directly.
  INSPECTION_OFFICER: ["rider.read"],
  RIDER: ["rider.read"],
  // Parents see their linked children only — `rider.read` opens the door, route handlers
  // enforce the parent-link filter so a parent can't query other riders.
  PARENT: ["rider.read"],
};

export function can(role: Role, perm: Permission): boolean {
  return matrix[role]?.includes(perm) ?? false;
}

export function requirePerm(role: Role, perm: Permission) {
  if (!can(role, perm)) throw new Error(`FORBIDDEN:${perm}`);
}

export function permissionsFor(role: Role): Permission[] {
  return matrix[role] ?? [];
}
