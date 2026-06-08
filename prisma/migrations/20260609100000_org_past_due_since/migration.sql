-- Track when an organisation most recently entered past_due. Dunning reminders
-- and the 7-day suspend countdown now anchor on this instead of updatedAt, which
-- any unrelated org write bumps (and used to silently reset the overdue clock).
ALTER TABLE "Organisation" ADD COLUMN "pastDueSince" TIMESTAMP(3);

-- Backfill existing past_due orgs so the countdown has a sensible start point
-- (their last-updated time) rather than null. New transitions stamp it directly.
UPDATE "Organisation" SET "pastDueSince" = "updatedAt" WHERE "status" = 'past_due';
