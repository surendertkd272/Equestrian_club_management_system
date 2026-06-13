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
