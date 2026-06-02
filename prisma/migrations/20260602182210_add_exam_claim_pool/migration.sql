-- AlterTable
ALTER TABLE "Exam" ALTER COLUMN "examinerId" DROP NOT NULL,
ALTER COLUMN "examinerName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ExamSitting" ALTER COLUMN "examinerId" DROP NOT NULL,
ALTER COLUMN "examinerName" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ExamSittingExaminer" (
    "id" TEXT NOT NULL,
    "sittingId" TEXT NOT NULL,
    "examinerId" TEXT NOT NULL,
    "examinerName" TEXT NOT NULL,

    CONSTRAINT "ExamSittingExaminer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamSittingExaminer_examinerId_idx" ON "ExamSittingExaminer"("examinerId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSittingExaminer_sittingId_examinerId_key" ON "ExamSittingExaminer"("sittingId", "examinerId");

-- AddForeignKey
ALTER TABLE "ExamSittingExaminer" ADD CONSTRAINT "ExamSittingExaminer_sittingId_fkey" FOREIGN KEY ("sittingId") REFERENCES "ExamSitting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
