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
};

export type SweepOpts = { force?: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Dedup helper — skip if any notif of (userId, type) referencing the same row
// has been emitted in the last `windowMs` milliseconds.
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
      payload: { contains: rowKey },
    },
    select: { id: true },
  });
  return existing !== null;
}

export async function centreManagerId(centreId: string): Promise<string | null> {
  const c = await prisma.centre.findUnique({ where: { id: centreId }, select: { managerId: true } });
  return c?.managerId ?? null;
}
