-- AlterTable
ALTER TABLE "EmployeeOnboarding" ADD COLUMN     "createdUserId" TEXT,
ADD COLUMN     "documentsDueAt" TIMESTAMP(3),
ADD COLUMN     "overdueNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "waivedItemsJson" JSONB;

-- CreateIndex
CREATE INDEX "EmployeeOnboarding_createdUserId_idx" ON "EmployeeOnboarding"("createdUserId");
