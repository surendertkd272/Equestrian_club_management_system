-- Exam panel: the lead examiner's card can now be locked on its own, and a
-- completed exam can be reopened for correction. See Exam.leadSubmittedAt /
-- reopenedAt in schema.prisma and lib/exam-panel.ts.
ALTER TABLE "Exam" ADD COLUMN "leadSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Exam" ADD COLUMN "reopenedAt" TIMESTAMP(3);
ALTER TABLE "Exam" ADD COLUMN "reopenedBy" TEXT;
ALTER TABLE "Exam" ADD COLUMN "reopenReason" TEXT;

-- Every exam that already completed did so on the lead's submission, so its
-- lead card counts as locked.
UPDATE "Exam"
SET "leadSubmittedAt" = "updatedAt"
WHERE "status" = 'completed' AND "leadSubmittedAt" IS NULL;

-- Exam.rubricSnapshotJson was read everywhere but never written, so every exam
-- fell back to the LIVE template: editing a rubric changed the rules for exams
-- in progress and rewrote old result sheets. Pin each exam to the rubric it is
-- being (or was last) displayed with, which is its centre's current template.
-- Only fills NULLs; exam creation now writes the snapshot itself.
UPDATE "Exam" AS e
SET "rubricSnapshotJson" = t."categoriesJson"
FROM "ScoringTemplate" AS t
WHERE e."rubricSnapshotJson" IS NULL
  AND t."centreId" = e."centreId"
  AND t."levelKey" = e."level"::text;
