// Shared helpers for the Daily Coach Update feature. The app keys one update
// per coach per day in IST (the centres are India-based), stored as UTC-noon
// so the date can never drift across a timezone boundary.

// "Today" in IST as YYYY-MM-DD.
export function istTodayStr(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

// "Yesterday" in IST as YYYY-MM-DD (used by the file reminder sweep).
export function istYesterdayStr(): string {
  return new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);
}

// The date-only key stored in CoachDailyUpdate.date for a YYYY-MM-DD string.
export function coachUpdateDateKey(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

// Roles that file a daily update (and that the reminder/KPI count as "coaches").
export const DAILY_UPDATE_ROLES = ["COACH", "HEAD_COACH"] as const;
