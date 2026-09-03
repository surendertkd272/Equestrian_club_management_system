-- Receipts: money received that settles no invoice.
--
-- A club that does not bill riders through the platform still takes fees —
-- ₹1,000 from one family, ₹2 lakh from another — and still needs to see what
-- came in this month. Payment.invoiceId was NOT NULL and invoices are only
-- created by the billing flow, so such a club could record nothing at all and
-- its revenue read zero forever.
--
-- Same table on purpose: reversals, exports and every sum(amount) keep working
-- across invoice-settling payments and free-standing receipts alike.

-- 1. The payment's own centre. Revenue was scoped as
--    `where: { invoice: { centreId } }`, so a receipt with no invoice would
--    have been silently excluded — the same zero-revenue bug in a new place.
ALTER TABLE "Payment" ADD COLUMN "centreId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "riderId" TEXT;

-- 2. Backfill from the invoice BEFORE the column is made NOT NULL, so no
--    existing row is left unscoped.
UPDATE "Payment" p
SET "centreId" = i."centreId", "riderId" = i."riderId"
FROM "Invoice" i
WHERE i.id = p."invoiceId" AND p."centreId" IS NULL;

-- Any payment whose invoice vanished cannot be scoped and must not silently
-- become invisible; fail the migration instead of guessing.
DO $$
DECLARE orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM "Payment" WHERE "centreId" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'Cannot backfill Payment.centreId for % row(s) with no invoice', orphans;
  END IF;
END $$;

ALTER TABLE "Payment" ALTER COLUMN "centreId" SET NOT NULL;

-- 3. Now the invoice link can be optional.
ALTER TABLE "Payment" ALTER COLUMN "invoiceId" DROP NOT NULL;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_centreId_fkey"
  FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_riderId_fkey"
  FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- "What came in this month at this centre" is now the headline finance query.
CREATE INDEX "Payment_centreId_paidAt_idx" ON "Payment" ("centreId", "paidAt");
CREATE INDEX "Payment_riderId_idx" ON "Payment" ("riderId");
