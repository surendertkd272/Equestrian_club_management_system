-- Credential handover sheet for club onboarding.
--
-- Stores the SYSTEM-GENERATED temp password, AES-256-GCM encrypted, so HQ can
-- re-open the handover sheet for a new academy instead of resetting every
-- account when the printout is lost.
--
-- Invariant enforced in application code (lib/issued-credential.ts): these
-- columns are non-null ONLY while the password is still the generated temp the
-- user has never replaced. They never hold a password a person chose.
ALTER TABLE "User" ADD COLUMN "issuedPasswordEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "issuedPasswordAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "issuedById" TEXT;

-- The handover sheet is "everyone at this centre who still holds an unused
-- temp password" — a partial index keeps that lookup cheap and, more usefully,
-- keeps the index itself tiny, since rows leave it as users rotate.
CREATE INDEX "User_issuedPasswordAt_idx" ON "User" ("centreId", "issuedPasswordAt")
  WHERE "issuedPasswordEnc" IS NOT NULL;
