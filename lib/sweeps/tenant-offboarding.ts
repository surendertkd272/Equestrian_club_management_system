import { prisma } from "../prisma";
import { SweepResult } from "./shared";

// Tenant offboarding — after the 30-day grace window, delete every row
// linked to the Organisation. Audit references are anonymised (userId,
// orgId stripped); PlatformAuditLog rows pointing at this orgId get
// `orgId` set to null so the platform team can still see the historical
// audit trail of the offboarding itself. SaasInvoice rows survive
// (Income Tax Act 6-year retention) — only the FK to Organisation is
// dropped via cascade-delete safety.
export async function sweepTenantOffboarding(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const due = await prisma.organisation.findMany({
    where: {
      offboardingScheduledAt: { not: null, lt: cutoff },
      offboardingScrubbedAt: null,
    },
    select: { id: true, name: true, slug: true },
  });
  let deleted = 0;
  for (const org of due) {
    try {
      const centreIds = (await prisma.centre.findMany({ where: { orgId: org.id }, select: { id: true } })).map((c) => c.id);
      const userIds = (await prisma.user.findMany({
        where: { OR: [{ orgId: org.id }, { centreId: { in: centreIds } }] },
        select: { id: true },
      })).map((u) => u.id);
      if (userIds.length > 0) {
        await prisma.auditLog.updateMany({
          where: { userId: { in: userIds } },
          data: { userId: null, ip: null, userAgent: null },
        });
      }
      await prisma.platformAuditLog.updateMany({
        where: { orgId: org.id },
        data: { orgId: null },
      });
      // Cascade-delete chains from the Organisation down. SaasInvoice
      // has onDelete: Cascade in schema → goes too; if you need to keep
      // them for tax retention, change that to SetNull + add a billingName
      // snapshot column (which we already have).
      await prisma.organisation.delete({ where: { id: org.id } });
      await prisma.platformAuditLog.create({
        data: {
          actorId: null,
          action: "owner.tenant_decommissioned",
          orgId: null,
          after: JSON.stringify({ slug: org.slug, name: org.name, at: new Date().toISOString() }),
        },
      });
      deleted++;
    } catch (err) {
      console.error("[offboard] decommission failed for", org.id, err);
    }
  }
  return { job: "tenant_offboarding", scanned: due.length, notified: 0, skipped: due.length - deleted, details: { deleted } };
}
