-- Last-4 digits of the rider's Aadhaar, for masked display without decrypting
-- the full (encrypted) aadhaarNo. Populated going forward by the write paths;
-- existing rows are backfilled by scripts/backfill-aadhaar-encryption.ts (which
-- also encrypts the full number, since that needs PII_ENCRYPTION_KEY at runtime
-- and can't be done in plain SQL).
ALTER TABLE "Rider" ADD COLUMN "aadhaarLast4" TEXT;
