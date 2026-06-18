import { prisma } from "@/lib/prisma";
import { startOfDayInTz } from "@/lib/tz";

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
