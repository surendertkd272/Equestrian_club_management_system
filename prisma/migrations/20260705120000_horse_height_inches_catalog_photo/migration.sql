-- 1. Horse height: hands (hh) → inches. Hand notation is base-4: the decimal
--    digit is INCHES 0-3 (one hand = 4 in), so 15.1 hh = 15 hands 1 inch = 61 in.
--    Hand-written as RENAME (Prisma diff would DROP+ADD and lose data).
ALTER TABLE "Horse" RENAME COLUMN "heightHh" TO "heightIn";

-- Convert stored hands values to inches. Guarded to <= 20 (the old validation
-- cap) so values already in inches (> 20) are untouched — safe to re-run.
UPDATE "Horse"
SET "heightIn" = FLOOR("heightIn") * 4 + ROUND((("heightIn" - FLOOR("heightIn")) * 10)::numeric)
WHERE "heightIn" IS NOT NULL AND "heightIn" <= 20;

-- 2. Equipment catalog item photo (thumbnail on inventory rows).
ALTER TABLE "EquipmentCatalog" ADD COLUMN "photoUrl" TEXT;
