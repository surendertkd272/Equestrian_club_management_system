import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public, unauthenticated health endpoint. Uptime monitors (Better Stack,
// Pingdom, Vercel monitoring, etc.) hit this. Two checks:
//   • The Next.js process answers.
//   • Prisma can round-trip a trivial query (proves the DB connection is
//     alive, not just that the env var exists).
// On DB failure we return 503 so the uptime check fires, but we don't
// leak the error text — it goes to the server log only.
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
  return NextResponse.json({
    ok: true,
    service: "equiwings",
    version: process.env.APP_VERSION ?? "dev",
    env: process.env.NODE_ENV ?? "unknown",
    region: process.env.VERCEL_REGION ?? null,
    elapsedMs: Date.now() - startedAt,
    at: new Date().toISOString(),
  });
}
