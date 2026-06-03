-- CreateTable
CREATE TABLE "EmployeeOnboarding" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "fullName" TEXT,
    "fatherName" TEXT,
    "emergencyContact" TEXT,
    "dob" TIMESTAMP(3),
    "permanentAddress" TEXT,
    "email" TEXT,
    "maritalStatus" TEXT,
    "aadhaarNumber" TEXT,
    "panNumber" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "bankName" TEXT,
    "prevEmployment" TEXT,
    "agreedSalary" DOUBLE PRECISION,
    "foodCharges" DOUBLE PRECISION,
    "otherAllowances" TEXT,
    "pfEsicConsent" BOOLEAN NOT NULL DEFAULT false,
    "policeVerificationDetails" TEXT,
    "employmentType" TEXT,
    "dateOfJoining" TIMESTAMP(3),
    "references" TEXT,
    "photoUrl" TEXT,
    "aadhaarUrl" TEXT,
    "panUrl" TEXT,
    "bankProofUrl" TEXT,
    "prevEmploymentUrl" TEXT,
    "policeVerificationUrl" TEXT,
    "characterCertUrl" TEXT,
    "agreementAccepted" BOOLEAN NOT NULL DEFAULT false,
    "declarationAccepted" BOOLEAN NOT NULL DEFAULT false,
    "declarationName" TEXT,
    "createdByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewNotes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeOnboarding_tokenHash_key" ON "EmployeeOnboarding"("tokenHash");

-- CreateIndex
CREATE INDEX "EmployeeOnboarding_centreId_status_idx" ON "EmployeeOnboarding"("centreId", "status");

-- AddForeignKey
ALTER TABLE "EmployeeOnboarding" ADD CONSTRAINT "EmployeeOnboarding_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;
