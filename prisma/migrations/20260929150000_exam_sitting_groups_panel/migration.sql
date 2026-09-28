-- Exam-day groups (a level larger than one sitting runs as Group 1, 2, …) and
-- a sitting-level jury panel (co-judges seated on every rider in the sitting).
-- Columns on an existing table: its RLS policy already covers them.
ALTER TABLE "ExamSitting" ADD COLUMN "groupNo" INTEGER;
ALTER TABLE "ExamSitting" ADD COLUMN "panelJudgeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
