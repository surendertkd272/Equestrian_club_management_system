-- Daily coach checklist: shift (morning/evening), coach truthful-submission
-- declaration, and stable-manager countersign — the fields the EQUIWINGS paper
-- form has that the digital checklist was missing.
-- AlterTable
ALTER TABLE "ChecklistSubmission" ADD COLUMN     "declarationAgreed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "shift" TEXT;
