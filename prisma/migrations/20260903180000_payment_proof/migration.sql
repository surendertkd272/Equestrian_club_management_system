-- Proof of a fee received: a UPI screenshot, bank slip or scanned receipt.
--
-- For a club that collects privately this IS the evidence the payment
-- happened — there is no gateway record behind it, so a bare figure typed by
-- staff is unverifiable months later.
ALTER TABLE "Payment" ADD COLUMN "proofUrl" TEXT;
