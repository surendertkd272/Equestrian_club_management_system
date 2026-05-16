import { prisma } from "./prisma";

// DEFERRED — audit hash chain (#19): the audit table is append-only by
// convention but not by structure. Each row should carry `prevHash` (sha256
// of the previous row's serialised contents) so a tamper attempt is
// detectable by a `verify-audit-chain` cron job. Implementation cost: one
// migration adding a `hash` and `prevHash` column, a write-side hash
// computation here, and a small verifier in lib/sweeps.ts. Deferred because
// SQLite doesn't have row-level locking strong enough for the linear
// write-order guarantee we'd need; revisit when we move to Postgres.

export async function audit(opts: {
  userId?: string | null;
  action: string;
  tableName: string;
  rowId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      userId: opts.userId ?? undefined,
      action: opts.action,
      tableName: opts.tableName,
      rowId: opts.rowId,
      before: opts.before ? JSON.stringify(opts.before) : null,
      after: opts.after ? JSON.stringify(opts.after) : null,
      ip: opts.ip ?? undefined,
      userAgent: opts.userAgent ?? undefined,
    },
  });
}
