import { prisma } from "@/lib/prisma";
import { startOfDayInTz, endOfDayInTz, wallPartsInTz } from "@/lib/tz";

// Resolve a centre's IANA timezone, defaulting to IST (the app default) for a
// null / HQ-aggregate centre or an unknown id.
export async function resolveCentreTz(centreId: string | null | undefined): Promise<string> {
  if (!centreId) return "Asia/Kolkata";
  const c = await prisma.centre.findUnique({ where: { id: centreId }, select: { timezone: true } });
  return c?.timezone ?? "Asia/Kolkata";
}

// Start of *today* in the centre's local zone, as a UTC instant. Use this as
// the boundary for "overdue / expired / due" coloring of date-level deadlines
// so they don't flip the moment the server's UTC clock (Vercel runs UTC)
// crosses midnight or the stored time-of-day — a deadline due today should
// read as due today, not overdue, until the centre's local day actually ends.
export async function startOfTodayForCentre(centreId: string | null | undefined): Promise<Date> {
  return startOfDayInTz(new Date(), await resolveCentreTz(centreId));
}

// End of *today* in the centre's local zone, as a UTC instant. Pair with
// startOfTodayForCentre() to bound "what happened today" queries — a UTC
// midnight-to-midnight window is the wrong 24 hours for an Indian club by
// five and a half of them.
export async function endOfTodayForCentre(centreId: string | null | undefined): Promise<Date> {
  return endOfDayInTz(new Date(), await resolveCentreTz(centreId));
}

// Today's calendar date in the centre's zone as "YYYY-MM-DD". Use this for
// date-picker defaults and max attributes instead of
// `new Date().toISOString().slice(0,10)`, which is the UTC date — for the
// first 5½ hours of every Indian day that string is YESTERDAY, so the
// attendance register opened on the wrong day and today wasn't selectable.
export async function todayYmdForCentre(centreId: string | null | undefined): Promise<string> {
  return wallPartsInTz(new Date(), await resolveCentreTz(centreId)).date;
}
