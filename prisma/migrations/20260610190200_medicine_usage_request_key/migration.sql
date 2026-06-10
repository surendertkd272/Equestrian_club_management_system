-- AlterTable
ALTER TABLE "MedicineUsage" ADD COLUMN     "requestKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MedicineUsage_requestKey_key" ON "MedicineUsage"("requestKey");
