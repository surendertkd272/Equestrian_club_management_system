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
  | "competition.manage"
  | "event.manage"
  | "expense.manage"
  | "accreditation.manage"
  | "finance.read"
  | "finance.write"
  | "certificate.issue"
  | "certificate.bulk"
  | "audit.read";

const matrix: Record<Role, Permission[]> = {
  SUPER_ADMIN: [
    "centre.manage", "rider.read", "rider.write", "rider.onboard", "attendance.mark",
    "progress.write", "assessment.score", "exam.schedule", "exam.score", "exam.template_edit",
    "staff.manage", "staff.attendance", "leave.request", "leave.approve",
    "task.assign", "task.complete", "asset.manage",
    "medicine.manage", "medicine.prescribe", "horse.manage", "competition.manage",
    "event.manage", "expense.manage", "accreditation.manage",
    "finance.read", "finance.write", "certificate.issue", "certificate.bulk", "audit.read",
  ],
  CENTRE_MANAGER: [
    "rider.read", "rider.write", "rider.onboard", "attendance.mark", "progress.write",
    "exam.schedule", "exam.score",
    "staff.manage", "staff.attendance", "leave.request", "leave.approve",
    "task.assign", "task.complete", "asset.manage", "medicine.manage", "horse.manage", "competition.manage",
    "event.manage", "expense.manage", "accreditation.manage",
    "finance.read", "finance.write", "certificate.issue", "certificate.bulk",
  ],
  HEAD_COACH: [
    // Senior trainer — broader than a regular coach. Can schedule exams and supervise other coaches'
    // task assignments. Doesn't touch finance or asset inventory.
    "rider.read", "rider.write", "attendance.mark", "progress.write",
    "exam.schedule", "exam.score", "assessment.score",
    "staff.attendance", "leave.request", "leave.approve",
    "task.assign", "task.complete", "horse.manage",
  ],
  COACH: ["rider.read", "attendance.mark", "progress.write", "task.complete", "leave.request"],
  STABLE_MANAGER: [
    // Owns the stable + horse roster + the tack/grooming kit needed for daily ops.
    "horse.manage", "asset.manage", "task.assign", "task.complete",
    "staff.attendance", "leave.request", "leave.approve",
  ],
  INVENTORY_MANAGER: [
    // Tack, school equipment, medicine inventory (stock side — vet still prescribes).
    "asset.manage", "medicine.manage", "task.complete", "leave.request",
  ],
  COMPETITION_MANAGER: [
    // Tournament planning. Needs rider read for entries; can issue participation certs.
    "competition.manage", "event.manage", "rider.read", "task.assign", "task.complete",
    "certificate.issue", "certificate.bulk", "leave.request",
  ],
  GROOM: ["task.assign", "task.complete", "asset.manage", "leave.request"],
  FARRIER: [
    // Specialist labour — logs shoeing tasks against horses; otherwise read-only.
    "horse.manage", "task.complete", "leave.request",
  ],
  VET: ["medicine.manage", "medicine.prescribe", "horse.manage", "task.complete", "leave.request"],
  ACCOUNTANT: ["medicine.manage", "finance.read", "finance.write", "expense.manage", "leave.request"],
  EXAMINER: ["rider.read", "assessment.score", "exam.score", "certificate.issue", "leave.request"],
  // Jury members score from a panel but don't schedule exams. They can
  // submit on their own ExamJudge row + score competition entries they're
  // assigned to. Issuing certificates remains with the lead examiner.
  JURY: ["rider.read", "exam.score", "competition.manage", "leave.request"],
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
