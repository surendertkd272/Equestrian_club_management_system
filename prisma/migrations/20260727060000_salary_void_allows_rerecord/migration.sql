-- DropIndex
DROP INDEX "SalaryPayment_userId_periodMonth_key";

-- AlterTable
ALTER TABLE "SalaryPayment" ADD COLUMN     "voidSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_userId_periodMonth_voidSeq_key" ON "SalaryPayment"("userId", "periodMonth", "voidSeq");
