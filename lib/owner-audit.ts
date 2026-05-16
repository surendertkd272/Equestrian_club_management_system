// Audit writer for platform-owner actions. Distinct from lib/audit.ts so the
// tenant and platform streams stay separable (one for compliance per tenant,
// one for our own operational record).

import { prisma } from "./prisma";

export async function auditOwner(opts: {
  actorId?: string | null;
  action: string;        // owner.tenant_updated | owner.plan_changed | owner.feature_toggled | ...
  orgId?: string | null; // target tenant, when applicable
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await prisma.platformAuditLog.create({
    data: {
      actorId: opts.actorId ?? undefined,
      action: opts.action,
      orgId: opts.orgId ?? undefined,
      before: opts.before ? JSON.stringify(opts.before) : null,
      after: opts.after ? JSON.stringify(opts.after) : null,
      ip: opts.ip ?? undefined,
      userAgent: opts.userAgent ?? undefined,
    },
  });
}
