/*
  Warnings:

  - You are about to drop the column `competitionId` on the `Certificate` table. All the data in the column will be lost.
  - You are about to drop the `Competition` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CompetitionEntry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CompetitionOfficial` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CompetitionRound` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CompetitionRoundScore` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CourseFence` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DressageScoresheet` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DressageTest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DrugTest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ExternalEntry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GymkhanaGame` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GymkhanaResult` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JumpEffort` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PrizeAward` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Protest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Sponsor` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StableAllocation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StartListEntry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Ticket` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TicketTier` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VetCheck` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Certificate" DROP CONSTRAINT "Certificate_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "Competition" DROP CONSTRAINT "Competition_centreId_fkey";

-- DropForeignKey
ALTER TABLE "CompetitionEntry" DROP CONSTRAINT "CompetitionEntry_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "CompetitionEntry" DROP CONSTRAINT "CompetitionEntry_riderId_fkey";

-- DropForeignKey
ALTER TABLE "CompetitionEntry" DROP CONSTRAINT "CompetitionEntry_teamId_fkey";

-- DropForeignKey
ALTER TABLE "CompetitionOfficial" DROP CONSTRAINT "CompetitionOfficial_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "CompetitionRound" DROP CONSTRAINT "CompetitionRound_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "CompetitionRound" DROP CONSTRAINT "CompetitionRound_dressageTestId_fkey";

-- DropForeignKey
ALTER TABLE "CompetitionRoundScore" DROP CONSTRAINT "CompetitionRoundScore_entryId_fkey";

-- DropForeignKey
ALTER TABLE "CompetitionRoundScore" DROP CONSTRAINT "CompetitionRoundScore_roundId_fkey";

-- DropForeignKey
ALTER TABLE "CourseFence" DROP CONSTRAINT "CourseFence_roundId_fkey";

-- DropForeignKey
ALTER TABLE "DressageScoresheet" DROP CONSTRAINT "DressageScoresheet_roundId_fkey";

-- DropForeignKey
ALTER TABLE "DressageScoresheet" DROP CONSTRAINT "DressageScoresheet_testId_fkey";

-- DropForeignKey
ALTER TABLE "DrugTest" DROP CONSTRAINT "DrugTest_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "ExternalEntry" DROP CONSTRAINT "ExternalEntry_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "GymkhanaGame" DROP CONSTRAINT "GymkhanaGame_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "GymkhanaResult" DROP CONSTRAINT "GymkhanaResult_entryId_fkey";

-- DropForeignKey
ALTER TABLE "GymkhanaResult" DROP CONSTRAINT "GymkhanaResult_gameId_fkey";

-- DropForeignKey
ALTER TABLE "JumpEffort" DROP CONSTRAINT "JumpEffort_roundId_fkey";

-- DropForeignKey
ALTER TABLE "PrizeAward" DROP CONSTRAINT "PrizeAward_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "PrizeAward" DROP CONSTRAINT "PrizeAward_sponsoredById_fkey";

-- DropForeignKey
ALTER TABLE "Protest" DROP CONSTRAINT "Protest_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "Sponsor" DROP CONSTRAINT "Sponsor_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "StableAllocation" DROP CONSTRAINT "StableAllocation_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "StartListEntry" DROP CONSTRAINT "StartListEntry_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "StartListEntry" DROP CONSTRAINT "StartListEntry_entryId_fkey";

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_tierId_fkey";

-- DropForeignKey
ALTER TABLE "TicketTier" DROP CONSTRAINT "TicketTier_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "VetCheck" DROP CONSTRAINT "VetCheck_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "VetCheck" DROP CONSTRAINT "VetCheck_horseId_fkey";

-- DropIndex
DROP INDEX "Certificate_competitionId_idx";

-- AlterTable
ALTER TABLE "Certificate" DROP COLUMN "competitionId";

-- DropTable
DROP TABLE "Competition";

-- DropTable
DROP TABLE "CompetitionEntry";

-- DropTable
DROP TABLE "CompetitionOfficial";

-- DropTable
DROP TABLE "CompetitionRound";

-- DropTable
DROP TABLE "CompetitionRoundScore";

-- DropTable
DROP TABLE "CourseFence";

-- DropTable
DROP TABLE "DressageScoresheet";

-- DropTable
DROP TABLE "DressageTest";

-- DropTable
DROP TABLE "DrugTest";

-- DropTable
DROP TABLE "ExternalEntry";

-- DropTable
DROP TABLE "GymkhanaGame";

-- DropTable
DROP TABLE "GymkhanaResult";

-- DropTable
DROP TABLE "JumpEffort";

-- DropTable
DROP TABLE "PrizeAward";

-- DropTable
DROP TABLE "Protest";

-- DropTable
DROP TABLE "Sponsor";

-- DropTable
DROP TABLE "StableAllocation";

-- DropTable
DROP TABLE "StartListEntry";

-- DropTable
DROP TABLE "Ticket";

-- DropTable
DROP TABLE "TicketTier";

-- DropTable
DROP TABLE "VetCheck";
