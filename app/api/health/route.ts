import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public, unauthenticated health endpoint. Uptime monitors (Better Stack,
// Pingdom, Vercel monitoring, etc.) hit this. Two checks:
//   • The Next.js process answers.
//   • Prisma can round-trip a trivial query (proves the DB connection is
//     alive, not just that the env var exists).
// On DB failure we return 503 so the uptime check fires, but we don't
// leak the error text — it goes to the server log only.
//
// It also reports whether the nightly sweep is running. That batch was dead for
// two months without a single alarm: a rejected cron returns 401 and writes
// nothing, and the existing staleness indicator lives on an owner-portal page
// no club ever opens. Exposing it here means any uptime monitor already
// watching this endpoint can alert on it — and `cronStale` is a plain boolean
// so a monitor can assert on the body without parsing dates.
export async function GET() {
  const startedAt = Date.now();
  try {
    // SQLite + Postgres both honour SELECT 1; the round-trip is the goal.
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("[health] db round-trip failed", err);
    return NextResponse.json(
      { ok: false, error: "DB_UNREACHABLE" },
      { status: 503 },
    );
  }
  // Best-effort: a failure to read this must not make the service look down.
  let lastCronAt: Date | null = null;
  try {
    const row = await prisma.auditLog.findFirst({
      where: { action: "cron.sweep" },
      orderBy: { at: "desc" },
      select: { at: true },
    });
    lastCronAt = row?.at ?? null;
  } catch {
    lastCronAt = null;
  }
  const cronAgeHours = lastCronAt ? (Date.now() - lastCronAt.getTime()) / 3_600_000 : null;
  // 25h, not 24: the schedule is daily, so a little slack avoids flapping.
  const cronStale = cronAgeHours === null || cronAgeHours > 25;

  return NextResponse.json({
    ok: true,
    service: "equiwings",
    cronStale,
    lastCronAt: lastCronAt?.toISOString() ?? null,
    version: process.env.APP_VERSION ?? "dev",
    env: process.env.NODE_ENV ?? "unknown",
    region: process.env.VERCEL_REGION ?? null,
    elapsedMs: Date.now() - startedAt,
    at: new Date().toISOString(),
  });
}
