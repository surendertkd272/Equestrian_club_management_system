-- Per-session revocation denylist (B4 in docs/LOGIN_AUTH_AUDIT.md).
--
-- /api/auth/logout only deleted the cookie, so a copy of the JWT stayed valid
-- for the rest of its 8h life after the user pressed "Sign out". Bumping
-- tokenVersion would have closed that by signing the user out on every device
-- at once, which isn't what signing out of one laptop means — so revocation is
-- keyed on the token's own `jti` claim instead.
--
-- Rows are needed only until the revoked token would have expired anyway; the
-- session_revocation_purge sweep drops them after that.

CREATE TABLE "RevokedSession" (
    "jti" TEXT NOT NULL,
    "userId" TEXT,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");

-- RLS, per the project invariant: Supabase auto-enables row-level security, so
-- a table with no policy is deny-all for the NOBYPASSRLS app_rls role — and a
-- denied read here would mean revocation silently stops working.
--
-- Deliberately permissive: revocation is checked on every authenticated request
-- including ones where no org is bound yet, and a jti is an opaque random
-- identifier carrying no tenant data.
ALTER TABLE "RevokedSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RevokedSession" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "RevokedSession_org_isolation" ON "RevokedSession";
CREATE POLICY "RevokedSession_org_isolation" ON "RevokedSession" FOR ALL
  USING (true)
  WITH CHECK (true);
