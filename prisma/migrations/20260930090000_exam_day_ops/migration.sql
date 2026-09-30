-- Exam-day operations: absent riders, running order with per-rider slots, and
-- a horse booked per exam rider. Columns on existing tables — their RLS
-- policies already cover them.
ALTER TABLE "Exam" ADD COLUMN "absentAt" TIMESTAMP(3);
ALTER TABLE "Exam" ADD COLUMN "absentReason" TEXT;
ALTER TABLE "Exam" ADD COLUMN "runOrder" INTEGER;
ALTER TABLE "ExamSitting" ADD COLUMN "slotMinutes" INTEGER;
ALTER TABLE "HorseAllocation" ADD COLUMN "examId" TEXT;
CREATE UNIQUE INDEX "HorseAllocation_examId_key" ON "HorseAllocation"("examId");
ALTER TABLE "HorseAllocation" ADD CONSTRAINT "HorseAllocation_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
