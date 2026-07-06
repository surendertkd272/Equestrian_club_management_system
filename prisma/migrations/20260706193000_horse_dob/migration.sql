-- Horse date of birth. Age is derived from this for display; the existing
-- ageYears column is kept as a fallback for horses entered before DOB capture.
ALTER TABLE "Horse" ADD COLUMN "dob" TIMESTAMP(3);
