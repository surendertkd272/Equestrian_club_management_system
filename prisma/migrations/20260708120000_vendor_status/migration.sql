-- Vendor review state for public self-registration. Existing rows default to
-- "active" (admin-created), so no behavioural change for current data.
ALTER TABLE "Vendor" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
CREATE INDEX "Vendor_centreId_status_idx" ON "Vendor"("centreId", "status");
