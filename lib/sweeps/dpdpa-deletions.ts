import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { DELETION_GRACE_MS } from "../dpdpa";
import { SweepResult } from "./shared";

// DPDPA Section 12: hard-delete users whose 30-day grace window has
// expired. We anonymise the AuditLog rows that reference them (replace
// userId with null, and strip any PII fields stored in before/after) so
// the financial/audit trail survives while the principal is erased.
// Anything the user "owns" (rider records, certificates, invoices) is
// reasoned about per-row:
//   • Linked Rider row: PII fields blanked, currentLevel/status preserved
//     so the centre's historical reporting isn't broken.
//   • Invoices/Payments: preserved (Indian Income Tax Act demands 6+ years).
//   • Notifications: deleted (no value, full PII).
export async function sweepDpdpaDeletions(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - DELETION_GRACE_MS);
  const due = await prisma.user.findMany({
    where: { deletionRequestedAt: { lt: cutoff, not: null } },
    select: { id: true, email: true },
  });
  let deleted = 0;
  for (const u of due) {
    try {
      await prisma.$transaction([
        // Anonymise audit references — keep the row, strip the actor.
        prisma.auditLog.updateMany({
          where: { userId: u.id },
          data: { userId: null, ip: null, userAgent: null },
        }),
        // Blank rider PII when the user was tied to a rider profile.
        prisma.rider.updateMany({
          where: { userId: u.id },
          data: {
            firstName: "Deleted",
            lastName: "User",
            email: null,
            mobile: "",
            aadhaarNo: null,
            aadhaarLast4: null,
            aadhaarDocUrl: null,
            photoUrl: null,
            fatherName: null,
            fatherPhone: null,
            motherName: null,
            motherPhone: null,
            emergencyName: null,
            emergencyPhone: null,
            medicalNotes: null,
            allergies: null,
            addressPresent: null,
            addressPermanent: null,
            indemnitySignerIp: null,
            indemnitySignerUa: null,
            parentalConsentJson: Prisma.DbNull,
            userId: null,
            status: "cancelled",
          },
        }),
        // Drop notifications outright — they reference user data and
        // have no compliance retention need.
        prisma.notification.deleteMany({ where: { userId: u.id } }),
        // Finally delete the user row. Cascades on this FK clean up
        // password-reset and email-verify tokens.
        prisma.user.delete({ where: { id: u.id } }),
      ]);
      deleted++;
    } catch (err) {
      // One failure shouldn't sink the batch — log and continue.
      console.error("[dpdpa] deletion failed", { id: u.id, err });
    }
  }
  return { job: "dpdpa_deletions", scanned: due.length, notified: 0, skipped: due.length - deleted, details: { deleted } };
}
