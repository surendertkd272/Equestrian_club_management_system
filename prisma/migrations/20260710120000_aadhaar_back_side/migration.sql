-- Aadhaar back-side scans (front + back). Additive, all nullable — no impact on existing rows.
ALTER TABLE "Staff" ADD COLUMN "aadhaarBackUrl" TEXT;
ALTER TABLE "EmployeeOnboarding" ADD COLUMN "aadhaarBackUrl" TEXT;
ALTER TABLE "Rider" ADD COLUMN "aadhaarBackDocUrl" TEXT;
