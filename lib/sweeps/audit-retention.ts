import { prisma } from "../prisma";
import { SweepResult } from "./shared";

// Audit-log retention sweep. Audit rows accumulate forever otherwise — at
// typical write volumes a busy tenant adds tens of thousands of rows a
// month, and most rows older than the retention window aren't useful for
// either forensic or compliance purposes. AUDIT_RETENTION_DAYS (default
// 730 = ~2 years) caps the table; tenants on heavy-compliance plans can
// raise the env var. We delete in capped batches so a one-off catch-up
// run can't lock the table for minutes.
export async function sweepAuditRetention(): Promise<SweepResult> {
  const days = Math.max(30, Math.min(3650, Number(process.env.AUDIT_RETENTION_DAYS ?? "730")));
  const cutoff = new Date(Date.now() - days * 86400000);
  const BATCH = 1000;
  let totalDeleted = 0;
  // Tenant audit log.
  for (let i = 0; i < 50; i++) {
    const old = await prisma.auditLog.findMany({
      where: { at: { lt: cutoff } },
      select: { id: true },
      take: BATCH,
    });
    if (old.length === 0) break;
    const { count } = await prisma.auditLog.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    totalDeleted += count;
    if (old.length < BATCH) break;
  }
  // Platform audit log — same retention rule. Separate table.
  let platformDeleted = 0;
  for (let i = 0; i < 50; i++) {
    const old = await prisma.platformAuditLog.findMany({
      where: { at: { lt: cutoff } },
      select: { id: true },
      take: BATCH,
    });
    if (old.length === 0) break;
    const { count } = await prisma.platformAuditLog.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    platformDeleted += count;
    if (old.length < BATCH) break;
  }
  return {
    job: "audit_retention",
    scanned: totalDeleted + platformDeleted,
    notified: 0,
    skipped: 0,
    details: { retentionDays: days, tenantDeleted: totalDeleted, platformDeleted },
  };
}
