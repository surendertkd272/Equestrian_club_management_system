-- Make emailVerifiedAt mean something (B5 in docs/LOGIN_AUTH_AUDIT.md).
--
-- The column was written by the verify flows and read by NOTHING, so the whole
-- verification round-trip was decorative. Sign-in now refuses an account whose
-- address was never proved — which only works if "never proved" is
-- distinguishable from "predates the check".
--
-- Every row that exists today has been signing in fine, so treat it as
-- verified and stamp it with its own createdAt (accurate enough, and more
-- honest than now(): these addresses were vouched for when the account was
-- made). Going forward, application code stamps admin-created users at
-- creation, and only the super-admin minted by tenant provisioning — who gets
-- a code emailed the moment the account exists — is left NULL.
--
-- Rows with a live, unconsumed verification code are the one exception: those
-- are genuinely mid-verification right now, and stamping them would skip the
-- step they're in the middle of.

UPDATE "User" u
   SET "emailVerifiedAt" = u."createdAt"
 WHERE u."emailVerifiedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "EmailVerifyToken" t
      WHERE t."userId" = u."id"
        AND t."usedAt" IS NULL
        AND t."expiresAt" > now()
   );
