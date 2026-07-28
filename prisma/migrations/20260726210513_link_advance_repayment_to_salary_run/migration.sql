-- AlterTable
ALTER TABLE "AdvanceRepayment" ADD COLUMN     "salaryPaymentId" TEXT;

-- CreateIndex
CREATE INDEX "AdvanceRepayment_salaryPaymentId_idx" ON "AdvanceRepayment"("salaryPaymentId");

-- AddForeignKey
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_salaryPaymentId_fkey" FOREIGN KEY ("salaryPaymentId") REFERENCES "SalaryPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
