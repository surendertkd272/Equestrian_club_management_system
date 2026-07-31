-- Durable rate-limit counters (B1 in docs/LOGIN_AUTH_AUDIT.md).
--
-- lib/rate-limit.ts was backed by an in-process Map. Production is serverless,
-- so every lambda instance held its own counters and cold starts reset them:
-- the real login cap was (limit x live instances), refreshed constantly, which
-- left brute-force protection close to absent.
--
-- Fixed-window counters — one row per (key, window), incremented with a single
-- atomic INSERT .. ON CONFLICT DO UPDATE so concurrent lambdas can't lose a
-- count to a read-modify-write race.

CREATE TABLE "RateLimitCounter" (
    "key" TEXT NOT NULL,
    -- Epoch milliseconds, not timestamps. These are written by a raw
    -- INSERT .. ON CONFLICT and read back through Prisma's typed API; a Date
    -- bound into raw SQL lands in a "timestamp without time zone" column as
    -- LOCAL wall time while the typed read treats it as UTC, so the two
    -- disagree by the server's offset and every lookup misses. Integers can't
    -- have that argument.
    "windowStart" BIGINT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" BIGINT NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key","windowStart")
);

-- Supports the expiry sweep (lib/sweeps/rate-limit-purge.ts).
CREATE INDEX "RateLimitCounter_expiresAt_idx" ON "RateLimitCounter"("expiresAt");

-- RLS, per the project invariant: Supabase auto-enables row-level security, so
-- a table with no policy is deny-all for the NOBYPASSRLS app_rls role and every
-- rate-limit check would throw.
--
-- This table is global infrastructure, not tenant data — the keys are hashes of
-- IPs and email addresses, there is no orgId to isolate on, and the limiter has
-- to work on the pre-auth login path where no org is bound yet. So the policy
-- is deliberately permissive, matching the other [global] tables in
-- 20260611090000_rls_full_coverage.
ALTER TABLE "RateLimitCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimitCounter" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "RateLimitCounter_org_isolation" ON "RateLimitCounter";
CREATE POLICY "RateLimitCounter_org_isolation" ON "RateLimitCounter" FOR ALL
  USING (true)
  WITH CHECK (true);
