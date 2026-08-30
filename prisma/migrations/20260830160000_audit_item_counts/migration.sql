-- Count-against-register for inventory inspections.
--
-- The inventory checklist was six generic prompts ("Saddles present &
-- accounted for") that could be ticked without counting anything. For an
-- inventory audit the discrepancy IS the finding, so an inventory run now
-- seeds one line per stock item: `expected` snapshotted from the register when
-- the run starts, `counted` recorded on the floor.
ALTER TABLE "AuditItem" ADD COLUMN "expected" INTEGER;
ALTER TABLE "AuditItem" ADD COLUMN "counted" INTEGER;
ALTER TABLE "AuditItem" ADD COLUMN "stockId" TEXT;
