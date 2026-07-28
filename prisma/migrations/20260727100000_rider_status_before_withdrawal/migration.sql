-- AlterTable
ALTER TABLE "Rider" ADD COLUMN     "statusBeforeWithdrawal" TEXT;

-- Backfill: SalaryPayment rows voided BEFORE the voidSeq migration all landed
-- on the DEFAULT 0, so they still occupy the one live slot for their month and
-- the corrected run cannot be recorded — the exact problem voidSeq was added to
-- solve. Give each voided row its own sequence, oldest first, leaving 0 free.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY "userId", "periodMonth" ORDER BY "voidedAt", id) AS rn
  FROM "SalaryPayment"
  WHERE "voidedAt" IS NOT NULL AND "voidSeq" = 0
)
UPDATE "SalaryPayment" sp SET "voidSeq" = ranked.rn
FROM ranked WHERE sp.id = ranked.id;
