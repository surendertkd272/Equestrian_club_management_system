-- Exam module round 3: hold results until published, gate check-in, slot
-- notices to families, coach exam nominations. Columns on existing tables —
-- their RLS policies already cover them.
ALTER TABLE "Exam" ADD COLUMN "checkedInAt" TIMESTAMP(3),
ADD COLUMN "slotNotified" TEXT,
ADD COLUMN "slotNotifiedAt" TIMESTAMP(3);
ALTER TABLE "ExamSitting" ADD COLUMN "holdResults" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "resultsPublishedAt" TIMESTAMP(3);
ALTER TABLE "ExamDay" ADD COLUMN "holdResults" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Rider" ADD COLUMN "examReadyLevel" INTEGER,
ADD COLUMN "examReadyAt" TIMESTAMP(3),
ADD COLUMN "examReadyBy" TEXT,
ADD COLUMN "examReadyNote" TEXT;
