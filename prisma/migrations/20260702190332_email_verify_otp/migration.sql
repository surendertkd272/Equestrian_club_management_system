/*
  Warnings:

  - You are about to drop the column `tokenHash` on the `EmailVerifyToken` table. All the data in the column will be lost.
  - Added the required column `codeHash` to the `EmailVerifyToken` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "EmailVerifyToken_tokenHash_key";

-- DropIndex
DROP INDEX "EmailVerifyToken_userId_expiresAt_idx";

-- AlterTable
ALTER TABLE "EmailVerifyToken" DROP COLUMN "tokenHash",
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codeHash" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "EmailVerifyToken_userId_usedAt_idx" ON "EmailVerifyToken"("userId", "usedAt");
