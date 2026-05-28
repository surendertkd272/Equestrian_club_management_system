import { prisma } from "../prisma";
import { notify } from "../notify";
import { SweepResult, centreManagerId, recentlyNotified } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Job 2c: Farrier overdue / upcoming digest.
// Two windows: visits scheduled in the next 7 days (heads-up) + completed
// visits past their nextDueAt (overdue). One digest per centre per day.
export async function sweepFarrierDigest(): Promise<SweepResult> {
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 86400000);

  const upcoming = await prisma.farrierVisit.findMany({
    where: { status: "scheduled", scheduledAt: { gte: now, lte: sevenDays } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, centreId: true, scheduledAt: true, horse: { select: { name: true, stableNo: true } } },
  });
  const overdue = await prisma.farrierVisit.findMany({
    where: { status: "completed", nextDueAt: { lt: now } },
    orderBy: { nextDueAt: "asc" },
    select: { id: true, centreId: true, nextDueAt: true, horse: { select: { name: true, stableNo: true } } },
  });

  const byCentre = new Map<string, { upcoming: typeof upcoming; overdue: typeof overdue }>();
  for (const v of upcoming) {
    const slot = byCentre.get(v.centreId) ?? { upcoming: [], overdue: [] };
    slot.upcoming.push(v);
    byCentre.set(v.centreId, slot);
  }
  for (const v of overdue) {
    const slot = byCentre.get(v.centreId) ?? { upcoming: [], overdue: [] };
    slot.overdue.push(v);
    byCentre.set(v.centreId, slot);
  }

  let notified = 0;
  let skipped = 0;
  for (const [centreId, slot] of byCentre.entries()) {
    if (slot.upcoming.length === 0 && slot.overdue.length === 0) continue;
    const mgrId = await centreManagerId(centreId);
    if (!mgrId) { skipped += 1; continue; }
    if (await recentlyNotified(mgrId, "farrier.digest", centreId, 23 * 60 * 60 * 1000)) {
      skipped += 1; continue;
    }
    const overduePart = slot.overdue.length > 0
      ? `${slot.overdue.length} horse${slot.overdue.length === 1 ? "" : "s"} overdue`
      : "";
    const upPart = slot.upcoming.length > 0
      ? `${slot.upcoming.length} visit${slot.upcoming.length === 1 ? "" : "s"} this week`
      : "";
    const title = [overduePart, upPart].filter(Boolean).join(" · ");
    const preview = [...slot.overdue, ...slot.upcoming].slice(0, 3)
      .map((v) => `${v.horse.name}${v.horse.stableNo ? ` (${v.horse.stableNo})` : ""}`).join(", ");
    await notify({
      userId: mgrId,
      centreId,
      type: "farrier.digest",
      title: `Farrier: ${title}`,
      body: preview,
      link: "/farriery",
      // centreId in payload is the dedup key recentlyNotified() searches for.
      payload: { centreId, upcoming: slot.upcoming.length, overdue: slot.overdue.length },
    });
    notified += 1;
  }

  return { job: "farrier_digest", scanned: upcoming.length + overdue.length, notified, skipped };
}
