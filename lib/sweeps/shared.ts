// Shared bits across the per-sweep files. Types + the two dedup
// helpers every sweep uses (notification deduplication + centre
// manager resolution). Kept thin so each sweep file imports just
// what it needs.

import { prisma } from "../prisma";

export type SweepResult = {
  job: string;
  scanned: number;
  notified: number;
  skipped: number;
  details?: unknown;
  // Set only when the job threw. runAllSweeps catches per-job failures
  // (Promise.allSettled) so one bad job doesn't abort the nightly batch;
  // the failure surfaces here instead of taking down the whole run.
  error?: string;
};

export type SweepOpts = { force?: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Dedup helper — skip if any notif of (userId, type) referencing the same row
// has been emitted in the last `windowMs` milliseconds.
//
// The rowKey is matched as a QUOTED JSON value (`"<id>"`), not a bare substring
// (H5). The payload is JSON and ids are always stored quoted, so wrapping both
// ends pins the match to the full id: previously `contains: rowKey` for a cuid
// that is a prefix of another row's id (e.g. "clxAB" vs "clxABCD") matched the
// longer id's payload and SUPPRESSED a legitimate, distinct escalation. cuids
// contain no quotes, so `"<id>"` matches that exact id value and nothing else.
export async function recentlyNotified(
  userId: string,
  type: string,
  rowKey: string,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type,
      createdAt: { gte: since },
      payload: { contains: `"${rowKey}"` },
    },
    select: { id: true },
  });
  return existing !== null;
}

export async function centreManagerId(centreId: string): Promise<string | null> {
  const c = await prisma.centre.findUnique({ where: { id: centreId }, select: { managerId: true } });
  return c?.managerId ?? null;
}

// Batch variant — for sweeps that iterate rows across many centres. The
// per-row centreManagerId() call costs one round-trip per row; this does
// one findMany() for the whole set and returns a Map. Use when scanning
// >5 rows touching >1 centre (e.g. fee_due, absence_escalation, birthdays).
//
//   const mgrs = await centreManagerMap(invoices.map((i) => i.centreId));
//   for (const inv of invoices) {
//     const mgrId = mgrs.get(inv.centreId);
//     …
//   }
//
// Returns `null` for centres that have no managerId set, matching
// centreManagerId()'s single-row behaviour.
export async function centreManagerMap(centreIds: string[]): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(centreIds));
  if (unique.length === 0) return new Map();
  const rows = await prisma.centre.findMany({
    where: { id: { in: unique } },
    select: { id: true, managerId: true },
  });
  const map = new Map<string, string | null>();
  for (const r of rows) map.set(r.id, r.managerId);
  // Centres that didn't come back (deleted between read and map) get null,
  // not undefined, so callers can do `map.get(id) ?? null` interchangeably.
  for (const id of unique) if (!map.has(id)) map.set(id, null);
  return map;
}
