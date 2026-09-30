-- After the exam day: results emailed per exam (passes and not), and families'
-- requests for a result to be reviewed.

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN "resultEmailSentAt" TIMESTAMP(3),
ADD COLUMN "resultEmailSentBy" TEXT;

-- CreateTable
CREATE TABLE "ExamReviewRequest" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "response" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamReviewRequest_centreId_status_idx" ON "ExamReviewRequest"("centreId", "status");

-- CreateIndex
CREATE INDEX "ExamReviewRequest_examId_idx" ON "ExamReviewRequest"("examId");

-- AddForeignKey
ALTER TABLE "ExamReviewRequest" ADD CONSTRAINT "ExamReviewRequest_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamReviewRequest" ADD CONSTRAINT "ExamReviewRequest_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Results already emailed through their certificate count as sent.
UPDATE "Exam" e
SET "resultEmailSentAt" = c."resultEmailSentAt", "resultEmailSentBy" = c."resultEmailSentBy"
FROM "Certificate" c
WHERE c."examId" = e."id" AND c."resultEmailSentAt" IS NOT NULL AND e."resultEmailSentAt" IS NULL;

-- RLS. Supabase auto-enables row level security on new tables, so a table with
-- no policy is deny-all to the app role. Centre-scoped, like Exam.
ALTER TABLE "ExamReviewRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamReviewRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExamReviewRequest_org_isolation" ON "ExamReviewRequest";
CREATE POLICY "ExamReviewRequest_org_isolation" ON "ExamReviewRequest" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Production connects as the NOBYPASSRLS `app_rls` role. Grant it the new
-- table explicitly rather than relying on default privileges; a no-op where
-- that role doesn't exist (local, CI, preview).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ExamReviewRequest" TO app_rls;
  END IF;
END $$;
