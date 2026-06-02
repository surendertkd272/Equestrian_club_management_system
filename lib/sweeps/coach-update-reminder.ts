import { prisma } from "../prisma";
import { notify } from "../notify";
import { istYesterdayStr, coachUpdateDateKey, DAILY_UPDATE_ROLES } from "../coach-update";
import { SweepResult, recentlyNotified } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Coach daily-update reminder. The cron fires at 02:00 UTC (~07:30 IST), so we
// nudge coaches who never filed YESTERDAY's end-of-day update. In-app only —
// a gentle "please file" rather than an email blast.
export async function sweepCoachUpdateReminder(): Promise<SweepResult> {
  const yStr = istYesterdayStr();
  const dateKey = coachUpdateDateKey(yStr);

  // Centre-bound coaches (HQ accounts have no centre and file no update).
  const coaches = await prisma.user.findMany({
    where: { role: { in: [...DAILY_UPDATE_ROLES] }, status: "active", centreId: { not: null } },
    select: { id: true, centreId: true },
  });

  // Who already filed yesterday — one query, then a membership set.
  const filed = await prisma.coachDailyUpdate.findMany({
    where: { date: dateKey },
    select: { coachUserId: true, centreId: true },
  });
  const filedSet = new Set(filed.map((f) => `${f.centreId}:${f.coachUserId}`));

  let notified = 0;
  let skipped = 0;
  for (const c of coaches) {
    if (filedSet.has(`${c.centreId}:${c.id}`)) {
      skipped += 1; // already filed
      continue;
    }
    // Dedup: at most one reminder per coach per missed day.
    if (await recentlyNotified(c.id, "coach_update.reminder", yStr, 23 * 60 * 60 * 1000)) {
      skipped += 1;
      continue;
    }
    await notify({
      userId: c.id,
      centreId: c.centreId,
      type: "coach_update.reminder",
      title: "Daily update not filed",
      body: `You haven't filed your coach update for ${yStr}. It takes ~60 seconds.`,
      link: "/daily-update",
      payload: { date: yStr },
    });
    notified += 1;
  }

  return { job: "coach_update_reminder", scanned: coaches.length, notified, skipped };
}
