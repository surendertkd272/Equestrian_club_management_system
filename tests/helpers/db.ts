// Test-DB helpers. Use these in beforeEach for any suite that touches Prisma.
//
// `resetDb()` deletes every row in dependency order (children → parents). FK
// constraints stay enabled and we delete each table sequentially so any partial
// failure surfaces the real error immediately rather than rolling back a batched
// transaction (which produces cryptic "Foreign key constraint violated:
// `foreign key`" placeholders).

import { prisma } from "@/lib/prisma";

export async function resetDb(): Promise<void> {
  // Children first, parents last. New models go at the top of this list.
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.staffAttendance.deleteMany();
  await prisma.staffGateEvent.deleteMany();
  await prisma.parentLink.deleteMany();
  // New-feature tables (vet visits, requisitions, hq expenses, short links).
  // Prescriptions cascade with VetVisit; explicit delete kept as belt-and-braces.
  await prisma.vetPrescription.deleteMany();
  await prisma.vetVisit.deleteMany();
  await prisma.requisition.deleteMany();
  await prisma.hqExpense.deleteMany();
  await prisma.shortLink.deleteMany();
  // Batch B: horse-health models. Drop before Horse + Centre.
  await prisma.farrierVisit.deleteMany();
  await prisma.horseHealthLog.deleteMany();
  await prisma.injuryLog.deleteMany();
  await prisma.vaccinationSchedule.deleteMany();
  // Batch C: consumables.
  await prisma.consumableMovement.deleteMany();
  await prisma.consumable.deleteMany();
  // Batch D: courses + facility bookings + approvals.
  await prisma.staffCertification.deleteMany();
  await prisma.courseEnrolment.deleteMany();
  await prisma.course.deleteMany();
  await prisma.facilityBooking.deleteMany();
  await prisma.approvalRequest.deleteMany();
  // Batch E: teams.
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  // UX phase 1: forgot-password tokens. Cascade-deleted with User but we drop
  // them here too so single-suite resets stay tidy.
  await prisma.passwordResetToken.deleteMany();
  await prisma.emailVerifyToken.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.scoringTemplate.deleteMany();
  await prisma.certificate.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.feePlan.deleteMany();
  await prisma.task.deleteMany();
  await prisma.medicineUsage.deleteMany();
  await prisma.medicine.deleteMany();
  await prisma.facility.deleteMany();
  await prisma.horseAllocation.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.feedPlan.deleteMany();
  await prisma.horse.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.assessment.deleteMany();
  await prisma.riderSkillStatus.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.progressLevel.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.rider.deleteMany();
  // Centre.managerId references User as a plain string column (no @relation); we
  // still drop users first to keep the order clean if a relation is ever added.
  await prisma.user.deleteMany();
  await prisma.centre.deleteMany();
  await prisma.orgFeature.deleteMany();
  // SaaS-side invoices reference Organisation; drop before parent.
  await prisma.saasInvoice.deleteMany();
  await prisma.organisation.deleteMany();
  // Platform side — separate auth domain. Audit log references PlatformUser,
  // so drop it first.
  await prisma.platformAuditLog.deleteMany();
  await prisma.platformUser.deleteMany();
  // Singleton config — keep at the end so it's only ever deleted after the
  // SaasInvoice rows that depend on its counter.
  await prisma.platformBillingConfig.deleteMany();
  // PlatformPricing has no FK dependencies; reset between suites so each
  // pricing test starts from the seeded defaults.
  await prisma.platformPricing.deleteMany();
}
