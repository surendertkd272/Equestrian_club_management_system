-- Exam day: several levels, one date, booked and managed as one event. Each
-- level on the day is an ordinary ExamSitting linked here. See ExamDay in
-- schema.prisma.

-- AlterTable
ALTER TABLE "ExamSitting" ADD COLUMN     "completedNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "examDayId" TEXT;

-- CreateTable
CREATE TABLE "ExamDay" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT NOT NULL DEFAULT '09:00',
    "notes" TEXT,
    "createdBy" TEXT,
    "completedNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamDay_centreId_date_idx" ON "ExamDay"("centreId", "date");

-- CreateIndex
CREATE INDEX "ExamSitting_examDayId_idx" ON "ExamSitting"("examDayId");

-- AddForeignKey
ALTER TABLE "ExamSitting" ADD CONSTRAINT "ExamSitting_examDayId_fkey" FOREIGN KEY ("examDayId") REFERENCES "ExamDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamDay" ADD CONSTRAINT "ExamDay_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Already-completed sittings must not send a "sitting complete" summary the
-- first time anyone marks a correction on them after this ships.
UPDATE "ExamSitting" s
SET "completedNotifiedAt" = NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Exam" e WHERE e."sittingId" = s."id" AND e."status" IN ('scheduled', 'in_progress')
);

-- RLS. Supabase auto-enables row level security on new tables, so a table with
-- no policy is deny-all to the app role. Same centre-scoped shape as
-- ExamSitting (rls_full_coverage).
ALTER TABLE "ExamDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamDay" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExamDay_org_isolation" ON "ExamDay";
CREATE POLICY "ExamDay_org_isolation" ON "ExamDay" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Production connects as the NOBYPASSRLS `app_rls` role. Grant it the new
-- table explicitly rather than relying on default privileges; a no-op where
-- that role doesn't exist (local, CI, preview).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ExamDay" TO app_rls;
  END IF;
END $$;
