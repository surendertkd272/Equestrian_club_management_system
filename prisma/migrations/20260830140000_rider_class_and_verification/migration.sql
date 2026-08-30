-- Rider school class/section, and the document-verification step that now
-- gates enrolment approval.
--
-- Class/section are free text on purpose: Indian boards label these very
-- differently (5 / V / Grade 5 / UKG / XI-Science) and a fixed list that
-- doesn't match a club's convention just collects the nearest wrong answer.
ALTER TABLE "Rider" ADD COLUMN "schoolClass" TEXT;
ALTER TABLE "Rider" ADD COLUMN "schoolSection" TEXT;

-- Verification is a separate recorded act from approval, so that "I looked at
-- this rider's documents" has a name and a time against it.
ALTER TABLE "Rider" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Rider" ADD COLUMN "verifiedByUserId" TEXT;
ALTER TABLE "Rider" ADD COLUMN "verifyNote" TEXT;

-- The approval queue asks "which pending enrolments are still unverified?" on
-- every page load. Partial, because a verified or non-pending row leaves the
-- index and the working set stays small.
CREATE INDEX "Rider_pending_verification_idx"
  ON "Rider" ("centreId", "createdAt")
  WHERE "status" = 'pending_approval' AND "verifiedAt" IS NULL;
