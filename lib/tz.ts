// Timezone-aware day boundaries. The server runs in UTC (Vercel), so
// `new Date().setHours(0,0,0,0)` gives UTC midnight — wrong for grouping
// events into a centre's LOCAL calendar day (IST is UTC+5:30, so anything
// after 18:30 UTC is already "tomorrow" locally). These helpers return the
// real UTC instant of local midnight / end-of-day in the given IANA zone, so
// day-bucketing matches what the centre sees on the wall clock.
//
// DST-safe: the offset is taken at the instant in question (India has no DST,
// so it's a constant +05:30, but this works for any zone). No date library —
// Intl only.

// Fallback display zone for SERVER-rendered dates where no specific centre is
// in scope — org-wide roll-ups, the platform-owner portal, print templates.
//
// Server components run on Vercel in UTC, so a bare `toLocaleString()` formats
// in UTC and every Indian time renders ~5.5h out. Where the relevant centre IS
// in scope, pass `centre.timezone` instead — that stays the correct answer, and
// this is only the floor.
//
// Overridable per deployment. Every centre on the platform today is
// Asia/Kolkata (that is also the Centre.timezone column default), so this is
// currently exact rather than approximate; a club in another zone would need
// its pages threading a real centre timezone through.
export const PLATFORM_TZ = process.env.PLATFORM_TIMEZONE ?? "Asia/Kolkata";

// Milliseconds the zone is ahead of UTC at `at` (e.g. +19800000 for IST).
function zoneOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Zone offsets are always a whole number of minutes, so round to the minute.
  // This also absorbs formatToParts' millisecond truncation — otherwise the
  // offset (and thus startOfDay) would drift by up to ~1s for sub-second times.
  return Math.round((wallAsUtc - at.getTime()) / 60000) * 60000;
}

// Start of the local calendar day containing `at`, as a UTC Date.
export function startOfDayInTz(at: Date, timeZone: string): Date {
  const off = zoneOffsetMs(at, timeZone);
  const local = new Date(at.getTime() + off); // shift so getUTC* reads wall clock
  const localMidnightAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0, 0);
  return new Date(localMidnightAsUtc - off);
}

// Last millisecond of the local calendar day containing `at`, as a UTC Date.
export function endOfDayInTz(at: Date, timeZone: string): Date {
  const off = zoneOffsetMs(at, timeZone);
  const local = new Date(at.getTime() + off);
  const localEndAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 23, 59, 59, 999);
  return new Date(localEndAsUtc - off);
}

// Do two instants fall on the same local calendar day in the given zone?
export function sameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  return startOfDayInTz(a, timeZone).getTime() === startOfDayInTz(b, timeZone).getTime();
}

// Wall-clock parts (calendar date + HH:MM) of an instant, as read in `timeZone`.
// For prefilling <input type="date"> / <input type="time"> and computing "today"
// so the values shown match the centre-local times the rest of the UI displays
// (rather than the server's UTC wall clock on Vercel).
export function wallPartsInTz(at: Date, timeZone: string): { date: string; time: string } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Parse a ZONELESS wall-clock string ("YYYY-MM-DD", "YYYY-MM-DDTHH:MM[:SS]") as
// local time in `timeZone`, returning the correct UTC instant. A bare
// `new Date("2026-06-18T06:00")` is parsed in the SERVER zone (UTC on Vercel),
// which stores a centre's 6 AM as 6 AM UTC = 11:30 AM IST — this fixes that.
// Strings already carrying a zone (Z or ±HH:MM) are unambiguous and returned as-is.
export function parseWallTimeInTz(s: string, timeZone: string): Date {
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return new Date(s); // unexpected shape — let the caller's validation handle it
  const [, y, mo, d, H = "0", Mi = "0", S = "0"] = m;
  const provisional = Date.UTC(+y, +mo - 1, +d, +H, +Mi, +S);
  // Subtract the zone offset to get the true UTC instant; refine once so a DST
  // boundary (where the offset differs side-to-side) resolves correctly.
  let off = zoneOffsetMs(new Date(provisional), timeZone);
  off = zoneOffsetMs(new Date(provisional - off), timeZone);
  return new Date(provisional - off);
}
