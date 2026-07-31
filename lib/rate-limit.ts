// Rate limiting, backed by the database so it actually holds in production.
//
// This used to be a `Map` in process memory. Production is serverless: every
// lambda instance kept its own copy of that Map and cold starts reset it, so
// the effective cap was (limit x live instances) and refreshed constantly.
// Login brute-force protection was, in practice, close to absent.
//
// Now: fixed-window counters in Postgres, one row per (key, window), bumped
// with a single atomic INSERT .. ON CONFLICT DO UPDATE. One round-trip per
// check, no locking, and concurrent lambdas can't lose a count to a
// read-modify-write race.
//
// Trade-off, stated plainly: a fixed window lets a burst straddling a boundary
// reach up to 2x the limit. A sliding log would be exact but costs a row per
// attempt plus a range scan. For throttling humans and scripted guessers the
// fixed window is the right call — and it is a different universe from
// per-instance memory.

import type { NextRequest } from "next/server";

export type RateResult = { ok: true } | { ok: false; retryAfterSec: number };

// ── In-memory fallback ───────────────────────────────────────────────────────
// Used only when the database check throws. A DB blip must not lock every user
// out of signing in, but it also must not throw the doors open — so we degrade
// to the old per-instance behaviour rather than failing open entirely.
const fallbackBuckets = new Map<string, number[]>();

function fallbackCheck(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (fallbackBuckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    const oldest = hits[0]!;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }
  hits.push(now);
  fallbackBuckets.set(key, hits);
  if (fallbackBuckets.size > 5000) {
    for (const [k, ts] of fallbackBuckets) {
      if (ts.every((t) => t < cutoff)) fallbackBuckets.delete(k);
    }
  }
  return { ok: true };
}

// ── Window maths ─────────────────────────────────────────────────────────────
// Both bounds are epoch MILLISECONDS as BigInt, matching the column types. See
// the RateLimitCounter model comment for why these aren't DateTimes.
function windowFor(now: number, windowMs: number): { windowStart: bigint; expiresAt: bigint } {
  const start = Math.floor(now / windowMs) * windowMs;
  return { windowStart: BigInt(start), expiresAt: BigInt(start + windowMs) };
}

function retryAfter(expiresAt: bigint, now: number): number {
  return Math.max(1, Math.ceil((Number(expiresAt) - now) / 1000));
}

// ── Durable check ────────────────────────────────────────────────────────────

/**
 * Consume one unit against `key`. Returns `{ok:false, retryAfterSec}` once more
 * than `limit` attempts land inside the same `windowMs` window.
 *
 * Counts the CURRENT attempt, so `limit` is the number of attempts allowed.
 */
export async function checkRate(key: string, limit: number, windowMs: number): Promise<RateResult> {
  const now = Date.now();
  // Align to a fixed window so every instance agrees on which row to bump
  // without coordinating. Epoch ms, not Dates — see the model comment.
  const { windowStart, expiresAt } = windowFor(now, windowMs);

  try {
    const { prisma } = await import("./prisma");
    // One statement: insert-or-increment, returning the post-increment count.
    // Two lambdas racing the same key both get a distinct value back, so
    // neither can overwrite the other's attempt.
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitCounter" ("key", "windowStart", "count", "expiresAt")
      VALUES (${key}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT ("key", "windowStart")
      DO UPDATE SET "count" = "RateLimitCounter"."count" + 1
      RETURNING "count"`;
    const count = rows[0]?.count ?? 1;
    if (count > limit) return { ok: false, retryAfterSec: retryAfter(expiresAt, now) };
    return { ok: true };
  } catch (err) {
    // Degrade, don't fail open and don't fail closed.
    console.error("[rate-limit] durable check failed, using in-process fallback", key, err);
    return fallbackCheck(key, limit, windowMs);
  }
}

/**
 * Read `key`'s current usage WITHOUT consuming any. Pair with recordFailure()
 * when only failed attempts should count against the cap — a sign-in flow that
 * charges successes too punishes a busy shared office far more than it
 * inconveniences a guesser.
 */
export async function peekRate(key: string, limit: number, windowMs: number): Promise<RateResult> {
  const now = Date.now();
  const { windowStart, expiresAt } = windowFor(now, windowMs);
  try {
    const { prisma } = await import("./prisma");
    const row = await prisma.rateLimitCounter.findUnique({
      where: { key_windowStart: { key, windowStart } },
      select: { count: true },
    });
    if ((row?.count ?? 0) >= limit) return { ok: false, retryAfterSec: retryAfter(expiresAt, now) };
    return { ok: true };
  } catch (err) {
    console.error("[rate-limit] peek failed, allowing", key, err);
    return { ok: true };
  }
}

/**
 * Charge one failed attempt against `key`. Never throws — a limiter that takes
 * down the sign-in route is worse than one that misses a count.
 */
export async function recordFailure(key: string, windowMs: number): Promise<void> {
  const { windowStart, expiresAt } = windowFor(Date.now(), windowMs);
  try {
    const { prisma } = await import("./prisma");
    await prisma.$executeRaw`
      INSERT INTO "RateLimitCounter" ("key", "windowStart", "count", "expiresAt")
      VALUES (${key}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT ("key", "windowStart")
      DO UPDATE SET "count" = "RateLimitCounter"."count" + 1`;
  } catch (err) {
    console.error("[rate-limit] recordFailure failed", key, err);
  }
}

/**
 * Drop the counters for `key`. Used to reset a failure counter after a
 * successful sign-in, so a user who mistypes their password four times and then
 * gets it right isn't left one slip away from a lockout.
 */
export async function clearRate(key: string): Promise<void> {
  fallbackBuckets.delete(key);
  try {
    const { prisma } = await import("./prisma");
    await prisma.rateLimitCounter.deleteMany({ where: { key } });
  } catch (err) {
    console.error("[rate-limit] clear failed", key, err);
  }
}

// ── Client identity ──────────────────────────────────────────────────────────

/**
 * Best available client identifier for a rate-limit key.
 *
 * Order matters. `x-forwarded-for` is a client-supplied header in the general
 * case — it is only trustworthy here because the hosting platform overwrites
 * it, so it is the LAST resort rather than the first. `req.ip` and
 * `x-vercel-forwarded-for` are set by the platform and cannot be spoofed by the
 * caller, so they come first.
 *
 * NOT a security primitive alone: shared NATs and mobile carriers put many
 * users behind one address. Always pair an IP axis with an account axis.
 */
export function clientFingerprint(req: Request | NextRequest): string {
  const ip = (req as NextRequest).ip;
  if (ip) return ip;
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip")?.trim() ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
