import { prisma } from "../prisma";
import { SweepResult } from "./shared";

// Accreditation expiry sweep:
//   1. Flip any active accreditation whose expiresAt has passed → "expired".
//   2. For accreditations expiring in the next 30 days, send ONE reminder
//      to the rider's centre manager (dedup via the notify "recently
//      notified" helper — same accreditation, same type, won't re-fire
//      within 7 days). National-eligibility credentials lapsing without
//      anyone noticing is the failure mode this prevents.
export async function sweepAccreditationExpiry(): Promise<SweepResult> {
  const now = new Date();
  const thirty = new Date(now.getTime() + 30 * 86400000);
  let scanned = 0;
  let notified = 0;
  let skipped = 0;

  // Step 1: flip expired.
  const expired = await prisma.accreditation.findMany({
    where: { status: "active", expiresAt: { not: null, lt: now } },
    select: { id: true },
  });
  if (expired.length > 0) {
    await prisma.accreditation.updateMany({
      where: { id: { in: expired.map((e) => e.id) } },
      data: { status: "expired" },
    });
  }
  scanned += expired.length;

  // Step 2: reminders for soon-to-expire (still active).
  const soon = await prisma.accreditation.findMany({
    where: {
      status: "active",
      expiresAt: { gte: now, lte: thirty },
    },
    include: { rider: { select: { firstName: true, lastName: true, centreId: true } } },
  });
  scanned += soon.length;

  for (const a of soon) {
    // Find a manager at the rider's centre to notify.
    const manager = await prisma.user.findFirst({
      where: {
        centreId: a.rider.centreId,
        role: { in: ["CENTRE_MANAGER", "HEAD_COACH"] as any },
        status: "active",
      },
      select: { id: true },
    });
    if (!manager) {
      skipped++;
      continue;
    }
    const days = Math.ceil(((a.expiresAt!.getTime() - now.getTime()) / 86400000));
    const fired = await notifyIfNotRecent(
      manager.id,
      "accreditation.expiring",
      `${a.rider.firstName} ${a.rider.lastName} · ${a.body} ${a.title}`,
      `Expires in ${days} day${days === 1 ? "" : "s"} (${a.expiresAt!.toISOString().slice(0, 10)}). Renew before then to keep eligibility.`,
      `/accreditations`,
      a.id,
    );
    if (fired) notified++;
    else skipped++;
  }

  return { job: "accreditation_expiry", scanned, notified, skipped };
}

// Local dedup helper for this sweep only — the rest of lib/sweeps uses
// shared.ts's recentlyNotified (payload-based dedup), but this sweep
// embeds the accreditation id inside the body text and dedups on that.
// Different enough to keep separate rather than overloading the shared
// helper with two signatures.
async function notifyIfNotRecent(
  userId: string,
  type: string,
  title: string,
  body: string,
  link: string,
  rowId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 7 * 86400000);
  const recent = await prisma.notification.findFirst({
    where: { userId, type, createdAt: { gte: since }, body: { contains: rowId } },
    select: { id: true },
  });
  if (recent) return false;
  await prisma.notification.create({
    data: { userId, type, title, body: `${body}\n\n[ref:${rowId}]`, link },
  });
  return true;
}
