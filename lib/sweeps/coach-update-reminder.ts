import { prisma } from "../prisma";
import { notify } from "../notify";
import { sendEmail, renderEmail } from "../email";
import { istYesterdayStr, coachUpdateDateKey, DAILY_UPDATE_ROLES } from "../coach-update";
import { SweepResult, recentlyNotified } from "./shared";

const APP_BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://cms.bharatsportsventure.com").replace(/\/$/, "");

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

// ─────────────────────────────────────────────────────────────────────────────
// Coach daily-update reminder. The cron fires at 02:00 UTC (~07:30 IST), so we
// nudge coaches who never filed YESTERDAY's end-of-day update. In-app + email
// (email is a no-op in envs where Resend isn't configured). One nudge per coach
// per missed day — the recentlyNotified guard covers both channels at once.
export async function sweepCoachUpdateReminder(): Promise<SweepResult> {
  const yStr = istYesterdayStr();
  const dateKey = coachUpdateDateKey(yStr);

  // Centre-bound coaches (HQ accounts have no centre and file no update).
  const coaches = await prisma.user.findMany({
    where: { role: { in: [...DAILY_UPDATE_ROLES] }, status: "active", centreId: { not: null } },
    select: { id: true, centreId: true, name: true, email: true, centre: { select: { name: true } } },
  });

  // Who already filed yesterday — one query, then a membership set.
  const filed = await prisma.coachDailyUpdate.findMany({
    where: { date: dateKey },
    select: { coachUserId: true, centreId: true },
  });
  const filedSet = new Set(filed.map((f) => `${f.centreId}:${f.coachUserId}`));

  let notified = 0;
  let emailed = 0;
  let skipped = 0;
  for (const c of coaches) {
    if (filedSet.has(`${c.centreId}:${c.id}`)) {
      skipped += 1; // already filed
      continue;
    }
    // Dedup: at most one reminder per coach per missed day (guards both channels).
    if (await recentlyNotified(c.id, "coach_update.reminder", yStr, 23 * 60 * 60 * 1000)) {
      skipped += 1;
      continue;
    }
    await notify({
      userId: c.id,
      centreId: c.centreId!,
      type: "coach_update.reminder",
      title: "Daily update not filed",
      body: `You haven't filed your coach update for ${yStr}. It takes ~60 seconds.`,
      link: "/daily-update",
      payload: { date: yStr },
    });
    notified += 1;

    // Email as a second channel so the nudge lands even if the coach isn't in
    // the app. Best-effort: sendEmail never throws (dry-run/logs when Resend
    // isn't configured, so this is safe to ship before the key is live).
    if (c.email) {
      const res = await sendEmail({
        to: c.email,
        subject: "Reminder: file your daily coach update",
        html: renderEmail({
          centreName: c.centre?.name,
          heading: "Daily update not filed",
          body: `<p>Hi ${escapeHtml(c.name)},</p>
<p>You haven't filed your coach update for <b>${yStr}</b> yet. It only takes about a minute — a quick note on the day's sessions, horses worked, and anything the team should know.</p>`,
          ctaText: "File today's update",
          ctaUrl: `${APP_BASE}/daily-update`,
        }),
        ref: { type: "coach_update.reminder", rowId: `${yStr}:${c.id}` },
      });
      if (res.ok && !res.skipped) emailed += 1;
    }
  }

  return { job: "coach_update_reminder", scanned: coaches.length, notified, skipped, details: { emailed } };
}
