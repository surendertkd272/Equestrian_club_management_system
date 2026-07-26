-- AlterTable
ALTER TABLE "Rider" ADD COLUMN     "lastDayAt" TIMESTAMP(3),
ADD COLUMN     "withdrawalReason" TEXT,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnByUserId" TEXT;
