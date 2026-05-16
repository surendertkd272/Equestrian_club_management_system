-- ===================================================================
-- EQUIWINGS — PRODUCTION SUPABASE SETUP
-- ===================================================================
--
-- One-shot SQL to take a fresh Supabase Postgres project to a fully-
-- functional Equiwings backend. Run this once against an EMPTY database.
--
-- HOW TO RUN
--   Option A — Supabase web SQL editor:
--     1. Open https://supabase.com/dashboard/project/<ref>/sql/new
--     2. Paste this whole file.
--     3. Click "Run". Watch for "Production setup complete." at the end.
--
--   Option B — psql from the repo root:
--     psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/supabase-production-setup.sql
--
-- WHAT IT DOES
--   1. Creates every table the app needs (92 tables).
--   2. Adds every index + foreign key.
--   3. Seeds the platform-level singletons + lazy-init defaults:
--        • PlatformBillingConfig (your invoicing identity)
--        • PlatformPricing (Starter / Pro / Enterprise display rows)
--        • DressageTest catalog placeholders (Prelim 14 / Novice 27 / Elementary 43)
--   4. Verifies via row counts at the end.
--
-- IDEMPOTENCY
--   This file is designed for a FIRST RUN on an empty DB. After this,
--   schema migrations go through `npx prisma db push` (or
--   `prisma migrate deploy`). Running this twice will error on the first
--   CREATE TABLE — wrap in TRUNCATE if you need to reset.
--
-- TRANSACTION
--   Wrapped in BEGIN/COMMIT — any failure rolls back the whole thing,
--   leaving you with a clean empty DB to retry.
-- ===================================================================

BEGIN;

-- -------------------------------------------------------------------
-- SECTION 1 — TABLES, INDEXES, FOREIGN KEYS
-- (auto-generated from prisma/schema.prisma via `prisma migrate diff`)
-- -------------------------------------------------------------------

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "contactName" TEXT,
    "billingEmail" TEXT,
    "phone" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "onboardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offboardingScheduledAt" TIMESTAMP(3),
    "offboardingNotes" TEXT,
    "offboardingScrubbedAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "subscriptionStatus" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "razorpaySubscriptionId" TEXT,
    "razorpaySubscriptionStatus" TEXT,
    "customDomain" TEXT,
    "customDomainVerifiedAt" TIMESTAMP(3),
    "settings" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "billingGstin" TEXT,
    "billingState" TEXT,
    "billingAddress" TEXT,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgFeature" (
    "orgId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabledBy" TEXT,

    CONSTRAINT "OrgFeature_pkey" PRIMARY KEY ("orgId","featureKey")
);

-- CreateTable
CREATE TABLE "PlatformPricing" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "tagline" TEXT NOT NULL DEFAULT '',
    "monthlyInr" INTEGER NOT NULL DEFAULT 0,
    "annualInrPerMonth" INTEGER NOT NULL DEFAULT 0,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "razorpayPlanIdMonthly" TEXT,
    "razorpayPlanIdAnnual" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformPricing_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlatformBillingConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "legalName" TEXT NOT NULL DEFAULT 'Equiwings Technologies Pvt Ltd',
    "gstin" TEXT,
    "hsnCode" TEXT DEFAULT '9984',
    "panNo" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "billingEmail" TEXT,
    "supportEmail" TEXT,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'EW',
    "invoiceCounter" INTEGER NOT NULL DEFAULT 0,
    "defaultTaxBps" INTEGER NOT NULL DEFAULT 1800,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformBillingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaHref" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "planFilter" TEXT,
    "roleFilter" TEXT,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementDismissal" (
    "userId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementDismissal_pkey" PRIMARY KEY ("userId","announcementId")
);

-- CreateTable
CREATE TABLE "NpsResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "orgId" TEXT,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NpsResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasInvoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "plan" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "taxBps" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "billingName" TEXT,
    "billingGstin" TEXT,
    "billingEmail" TEXT,
    "billingState" TEXT,
    "status" TEXT NOT NULL DEFAULT 'due',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "pdfUrl" TEXT,

    CONSTRAINT "SaasInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER_ADMIN',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "twoFactor" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "totpLastStep" BIGINT,
    "totpRecoveryCodesJson" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "orgId" TEXT,
    "before" TEXT,
    "after" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Centre" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "gstNo" TEXT,
    "managerId" TEXT,
    "settings" TEXT,
    "emergencyContactsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Centre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "centreId" TEXT,
    "orgId" TEXT,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "twoFactor" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "totpLastStep" BIGINT,
    "totpRecoveryCodesJson" TEXT,
    "deletionRequestedAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "notifPrefsJson" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerifyToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerifyToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerPasswordResetToken" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerPasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rider" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "photoUrl" TEXT,
    "dob" TIMESTAMP(3) NOT NULL,
    "placeOfBirth" TEXT,
    "nationality" TEXT,
    "gender" TEXT,
    "maritalStatus" TEXT,
    "aadhaarNo" TEXT,
    "aadhaarDocUrl" TEXT,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "preferredLanguage" TEXT,
    "school" TEXT,
    "education" TEXT,
    "occupation" TEXT,
    "addressPresent" TEXT,
    "addressPermanent" TEXT,
    "pincode" TEXT,
    "fatherName" TEXT,
    "fatherPhone" TEXT,
    "motherName" TEXT,
    "motherPhone" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "bmi" DOUBLE PRECISION,
    "medicalNotes" TEXT,
    "allergies" TEXT,
    "currentLevel" TEXT,
    "joiningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchId" TEXT,
    "coachId" TEXT,
    "indemnitySignedAt" TIMESTAMP(3),
    "indemnitySignerIp" TEXT,
    "indemnitySignerUa" TEXT,
    "indemnityDocUrl" TEXT,
    "parentalConsentJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "registrationPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dayOfWeek" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "coachId" TEXT,
    "level" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "markedBy" TEXT,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "batchId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "coachId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "rescheduledToId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressLevel" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ProgressLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderSkillStatus" (
    "riderId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "coachNotes" TEXT,
    "videoUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderSkillStatus_pkey" PRIMARY KEY ("riderId","skillId")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "levelId" TEXT,
    "type" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "examinerId" TEXT,
    "horseId" TEXT,
    "facilityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "joiningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kycDocsJson" TEXT,
    "salaryBand" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Horse" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "breed" TEXT,
    "sex" TEXT,
    "ageYears" INTEGER,
    "heightHh" DOUBLE PRECISION,
    "microchip" TEXT,
    "ownership" TEXT,
    "insuranceDocUrl" TEXT,
    "insurerName" TEXT,
    "insurancePolicyNo" TEXT,
    "insurancePremium" DOUBLE PRECISION,
    "insuranceValidFrom" TIMESTAMP(3),
    "insuranceValidTo" TIMESTAMP(3),
    "stableNo" TEXT,
    "diet" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Horse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetRoles" TEXT,
    "durationHrs" INTEGER,
    "passingMark" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseEnrolment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'enrolled',
    "finalMark" INTEGER,

    CONSTRAINT "CourseEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCertification" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "title" TEXT NOT NULL,
    "issuer" TEXT,
    "serialNo" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "fileUrl" TEXT,

    CONSTRAINT "StaffCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityBooking" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consumable" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "reorderThreshold" INTEGER NOT NULL DEFAULT 10,
    "supplier" TEXT,
    "storageLocation" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consumable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumableMovement" (
    "id" TEXT NOT NULL,
    "consumableId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumableMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StartListEntry" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "drawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StartListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizeAward" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "placement" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "cashAmount" DOUBLE PRECISION,
    "trophyLabel" TEXT,
    "sponsoredById" TEXT,
    "notes" TEXT,

    CONSTRAINT "PrizeAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sponsor" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "contribution" DOUBLE PRECISION,
    "notes" TEXT,
    "logoUrl" TEXT,

    CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarrierVisit" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "farrierName" TEXT NOT NULL,
    "farrierUserId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "workType" TEXT NOT NULL,
    "hoofNotes" TEXT,
    "cost" DOUBLE PRECISION,
    "nextDueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FarrierVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HorseHealthLog" (
    "id" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT,
    "tempC" DOUBLE PRECISION,
    "heartRateBpm" INTEGER,
    "respirationRpm" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "appetite" TEXT,
    "manure" TEXT,
    "notes" TEXT,

    CONSTRAINT "HorseHealthLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InjuryLog" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'minor',
    "cause" TEXT,
    "initialNotes" TEXT NOT NULL,
    "treatmentJson" TEXT,
    "recoveredAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "reportedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "horseSubjectId" TEXT,

    CONSTRAINT "InjuryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaccinationSchedule" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "vaccineKey" TEXT NOT NULL,
    "vaccineLabel" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "firstDueAt" TIMESTAMP(3),
    "lastGivenAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaccinationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HorseAllocation" (
    "id" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "riderId" TEXT,
    "purpose" TEXT NOT NULL,
    "lessonId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HorseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPlan" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "rationsJson" TEXT NOT NULL,
    "notes" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "capacity" INTEGER,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "qrCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "purchaseDate" TIMESTAMP(3),
    "cost" DOUBLE PRECISION,
    "depreciation" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetIssuance" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "issuedToUserId" TEXT,
    "issuedToRiderId" TEXT,
    "issuedToHorseId" TEXT,
    "issuedBy" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "returnedBy" TEXT,
    "conditionAtReturn" TEXT,
    "note" TEXT,

    CONSTRAINT "AssetIssuance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetMaintenance" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "vendor" TEXT,
    "cost" DOUBLE PRECISION,
    "scheduledAt" TIMESTAMP(3),
    "repairedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medicine" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "generic" TEXT,
    "category" TEXT NOT NULL,
    "schedule" TEXT,
    "batchNo" TEXT NOT NULL,
    "mfgDate" TIMESTAMP(3),
    "expDate" TIMESTAMP(3) NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "reorderThreshold" INTEGER NOT NULL DEFAULT 5,
    "supplier" TEXT,
    "storageLocation" TEXT,
    "coldChain" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Medicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineUsage" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "vetUserId" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "reason" TEXT,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawalUntil" TIMESTAMP(3),

    CONSTRAINT "MedicineUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT,
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3),
    "recurrence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "proofUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'internal',
    "discipline" TEXT NOT NULL DEFAULT 'generic',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "classesJson" TEXT NOT NULL,
    "entryDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "drawCompleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionEntry" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "horseId" TEXT,
    "teamId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'entered',
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "placement" INTEGER,
    "score" DOUBLE PRECISION,
    "faults" DOUBLE PRECISION,
    "time" DOUBLE PRECISION,
    "roundsJson" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundInvoiceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionRound" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phase" TEXT,
    "timeAllowedSec" DOUBLE PRECISION,
    "timeLimitSec" DOUBLE PRECISION,
    "optimumTimeSec" DOUBLE PRECISION,
    "speedMpm" INTEGER,
    "courseLengthM" INTEGER,
    "dressageTestId" TEXT,
    "judgingMode" TEXT,
    "dressagePenaltyFactor" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitionRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JumpEffort" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "fenceNo" TEXT NOT NULL,
    "knockdown" BOOLEAN NOT NULL DEFAULT false,
    "refusal" INTEGER NOT NULL DEFAULT 0,
    "eliminated" BOOLEAN NOT NULL DEFAULT false,
    "fall" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JumpEffort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DressageTest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT 'EFI',
    "movementsJson" TEXT NOT NULL,
    "collectiveMarksJson" TEXT,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DressageTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DressageScoresheet" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "judgeUserId" TEXT NOT NULL,
    "judgePosition" TEXT,
    "marksJson" TEXT NOT NULL,
    "collectiveMarksJson" TEXT,
    "percentage" DOUBLE PRECISION,
    "submittedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DressageScoresheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymkhanaGame" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "scoringType" TEXT NOT NULL DEFAULT 'time',
    "penaltyPerFault" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GymkhanaGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymkhanaResult" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "time" DOUBLE PRECISION,
    "faults" INTEGER NOT NULL DEFAULT 0,
    "points" DOUBLE PRECISION,
    "position" INTEGER,
    "eliminated" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymkhanaResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseFence" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "fenceNo" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "heightCm" INTEGER,
    "spreadCm" INTEGER,
    "type" TEXT,
    "notes" TEXT,

    CONSTRAINT "CourseFence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VetCheck" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "horseId" TEXT,
    "horseName" TEXT NOT NULL,
    "riderName" TEXT,
    "phase" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pass',
    "vetUserId" TEXT,
    "notes" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VetCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StableAllocation" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "boxNo" TEXT NOT NULL,
    "horseId" TEXT,
    "horseName" TEXT NOT NULL,
    "riderName" TEXT NOT NULL,
    "arrivalAt" TIMESTAMP(3),
    "departureAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StableAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugTest" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "horseId" TEXT,
    "horseName" TEXT NOT NULL,
    "riderName" TEXT NOT NULL,
    "sampleType" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedBy" TEXT,
    "submittedToLabAt" TIMESTAMP(3),
    "labRef" TEXT,
    "resultStatus" TEXT NOT NULL DEFAULT 'pending',
    "resultAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "DrugTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Protest" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "filedByUserId" TEXT,
    "filedByName" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "feePaid" BOOLEAN NOT NULL DEFAULT false,
    "feeAmount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'filed',
    "ruling" TEXT,
    "ruledByUserId" TEXT,
    "ruledAt" TIMESTAMP(3),
    "filedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Protest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalEntry" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "dob" TIMESTAMP(3),
    "parentName" TEXT,
    "parentRelation" TEXT,
    "parentPhone" TEXT,
    "accreditationBody" TEXT,
    "accreditationNumber" TEXT,
    "accreditationExpiry" TIMESTAMP(3),
    "horseName" TEXT,
    "horseBreed" TEXT,
    "horseHeightHh" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verifiedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedEntryId" TEXT,
    "rejectionReason" TEXT,
    "verifyTokenHash" TEXT,
    "verifyExpiresAt" TIMESTAMP(3),
    "filedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTier" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceInr" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerPhone" TEXT,
    "paymentRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "groupId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedInBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionOfficial" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "classNames" TEXT,
    "appointedBy" TEXT,
    "appointedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitionOfficial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionRoundScore" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "faults" DOUBLE PRECISION,
    "time" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitionRoundScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePlan" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "levelName" TEXT NOT NULL,
    "monthlyAmount" DOUBLE PRECISION NOT NULL,
    "registrationAmount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FeePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'due',
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "txnRef" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "examId" TEXT,
    "competitionId" TEXT,
    "type" TEXT NOT NULL,
    "levelName" TEXT,
    "serialNo" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "qrCode" TEXT NOT NULL,
    "signedBy" TEXT,
    "batchTag" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokeReason" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamLevel" (
    "id" TEXT NOT NULL,
    "discipline" TEXT NOT NULL DEFAULT 'general',
    "orderIndex" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passThreshold" INTEGER NOT NULL DEFAULT 70,
    "defaultRubricJson" TEXT,
    "minExaminerLevel" INTEGER,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ExamLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringTemplate" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "examLevelId" TEXT,
    "levelKey" TEXT NOT NULL,
    "levelName" TEXT NOT NULL,
    "passThreshold" INTEGER NOT NULL DEFAULT 70,
    "categoriesJson" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ScoringTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "examinerId" TEXT NOT NULL,
    "examinerName" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT NOT NULL DEFAULT '09:00',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "totalScore" DOUBLE PRECISION,
    "scoresJson" TEXT,
    "passed" BOOLEAN,
    "deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timeFaults" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supportStaffJson" TEXT,
    "previousExamId" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "sittingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamJudge" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "judgeId" TEXT NOT NULL,
    "judgeName" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 1,
    "scoresJson" TEXT,
    "subTotal" DOUBLE PRECISION,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "ExamJudge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAttachment" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSitting" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "examinerId" TEXT NOT NULL,
    "examinerName" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamSitting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "season" TEXT,
    "discipline" TEXT,
    "captainId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "position" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centreId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "payload" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAttendance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "overtimeHours" DOUBLE PRECISION,
    "notes" TEXT,
    "markedBy" TEXT,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentLink" (
    "id" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentCatalog" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "defaultThreshold" INTEGER NOT NULL DEFAULT 5,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentStock" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "threshold" INTEGER,
    "notes" TEXT,
    "lastLowNotifiedAt" TIMESTAMP(3),
    "lastRestockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentStockMovement" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "externalVenue" TEXT,
    "externalHostOrg" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capacity" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "contactName" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "vendorId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spentAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "invoiceRef" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "method" TEXT,
    "attachmentUrl" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Accreditation" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discipline" TEXT,
    "level" TEXT,
    "serialNo" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "fileUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accreditation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_customDomain_key" ON "Organisation"("customDomain");

-- CreateIndex
CREATE INDEX "OrgFeature_featureKey_idx" ON "OrgFeature"("featureKey");

-- CreateIndex
CREATE INDEX "Announcement_publishedAt_expiresAt_idx" ON "Announcement"("publishedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "AnnouncementDismissal_announcementId_idx" ON "AnnouncementDismissal"("announcementId");

-- CreateIndex
CREATE INDEX "NpsResponse_orgId_createdAt_idx" ON "NpsResponse"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "NpsResponse_score_idx" ON "NpsResponse"("score");

-- CreateIndex
CREATE UNIQUE INDEX "SaasInvoice_number_key" ON "SaasInvoice"("number");

-- CreateIndex
CREATE INDEX "SaasInvoice_orgId_issuedAt_idx" ON "SaasInvoice"("orgId", "issuedAt");

-- CreateIndex
CREATE INDEX "SaasInvoice_status_issuedAt_idx" ON "SaasInvoice"("status", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_orgId_at_idx" ON "PlatformAuditLog"("orgId", "at");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_at_idx" ON "PlatformAuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "Centre_slug_key" ON "Centre"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerifyToken_tokenHash_key" ON "EmailVerifyToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerifyToken_userId_expiresAt_idx" ON "EmailVerifyToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerPasswordResetToken_tokenHash_key" ON "OwnerPasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OwnerPasswordResetToken_ownerId_expiresAt_idx" ON "OwnerPasswordResetToken"("ownerId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_userId_key" ON "Rider"("userId");

-- CreateIndex
CREATE INDEX "Rider_centreId_idx" ON "Rider"("centreId");

-- CreateIndex
CREATE INDEX "Rider_batchId_idx" ON "Rider"("batchId");

-- CreateIndex
CREATE INDEX "Rider_status_idx" ON "Rider"("status");

-- CreateIndex
CREATE INDEX "Batch_centreId_idx" ON "Batch"("centreId");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_riderId_batchId_date_key" ON "Attendance"("riderId", "batchId", "date");

-- CreateIndex
CREATE INDEX "Lesson_centreId_date_idx" ON "Lesson"("centreId", "date");

-- CreateIndex
CREATE INDEX "Lesson_batchId_date_idx" ON "Lesson"("batchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressLevel_centreId_name_key" ON "ProgressLevel"("centreId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_userId_key" ON "Staff"("userId");

-- CreateIndex
CREATE INDEX "Staff_centreId_idx" ON "Staff"("centreId");

-- CreateIndex
CREATE INDEX "Horse_centreId_idx" ON "Horse"("centreId");

-- CreateIndex
CREATE INDEX "Course_centreId_active_idx" ON "Course"("centreId", "active");

-- CreateIndex
CREATE INDEX "CourseEnrolment_userId_status_idx" ON "CourseEnrolment"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseEnrolment_courseId_userId_key" ON "CourseEnrolment"("courseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCertification_serialNo_key" ON "StaffCertification"("serialNo");

-- CreateIndex
CREATE INDEX "StaffCertification_centreId_userId_idx" ON "StaffCertification"("centreId", "userId");

-- CreateIndex
CREATE INDEX "StaffCertification_validUntil_idx" ON "StaffCertification"("validUntil");

-- CreateIndex
CREATE INDEX "FacilityBooking_facilityId_startAt_idx" ON "FacilityBooking"("facilityId", "startAt");

-- CreateIndex
CREATE INDEX "FacilityBooking_centreId_startAt_idx" ON "FacilityBooking"("centreId", "startAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_centreId_status_idx" ON "ApprovalRequest"("centreId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_entityType_entityId_idx" ON "ApprovalRequest"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedBy_idx" ON "ApprovalRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "Consumable_centreId_category_idx" ON "Consumable"("centreId", "category");

-- CreateIndex
CREATE INDEX "Consumable_centreId_qty_idx" ON "Consumable"("centreId", "qty");

-- CreateIndex
CREATE INDEX "ConsumableMovement_consumableId_at_idx" ON "ConsumableMovement"("consumableId", "at");

-- CreateIndex
CREATE INDEX "StartListEntry_competitionId_className_idx" ON "StartListEntry"("competitionId", "className");

-- CreateIndex
CREATE UNIQUE INDEX "StartListEntry_competitionId_className_order_key" ON "StartListEntry"("competitionId", "className", "order");

-- CreateIndex
CREATE UNIQUE INDEX "StartListEntry_competitionId_className_entryId_key" ON "StartListEntry"("competitionId", "className", "entryId");

-- CreateIndex
CREATE INDEX "PrizeAward_competitionId_idx" ON "PrizeAward"("competitionId");

-- CreateIndex
CREATE UNIQUE INDEX "PrizeAward_competitionId_className_placement_key" ON "PrizeAward"("competitionId", "className", "placement");

-- CreateIndex
CREATE INDEX "Sponsor_competitionId_tier_idx" ON "Sponsor"("competitionId", "tier");

-- CreateIndex
CREATE INDEX "FarrierVisit_centreId_scheduledAt_idx" ON "FarrierVisit"("centreId", "scheduledAt");

-- CreateIndex
CREATE INDEX "FarrierVisit_horseId_scheduledAt_idx" ON "FarrierVisit"("horseId", "scheduledAt");

-- CreateIndex
CREATE INDEX "FarrierVisit_status_idx" ON "FarrierVisit"("status");

-- CreateIndex
CREATE INDEX "HorseHealthLog_horseId_recordedAt_idx" ON "HorseHealthLog"("horseId", "recordedAt");

-- CreateIndex
CREATE INDEX "HorseHealthLog_centreId_recordedAt_idx" ON "HorseHealthLog"("centreId", "recordedAt");

-- CreateIndex
CREATE INDEX "InjuryLog_centreId_occurredAt_idx" ON "InjuryLog"("centreId", "occurredAt");

-- CreateIndex
CREATE INDEX "InjuryLog_subjectType_subjectId_idx" ON "InjuryLog"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "InjuryLog_status_idx" ON "InjuryLog"("status");

-- CreateIndex
CREATE INDEX "VaccinationSchedule_centreId_nextDueAt_idx" ON "VaccinationSchedule"("centreId", "nextDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaccinationSchedule_horseId_vaccineKey_key" ON "VaccinationSchedule"("horseId", "vaccineKey");

-- CreateIndex
CREATE INDEX "HorseAllocation_horseId_startAt_idx" ON "HorseAllocation"("horseId", "startAt");

-- CreateIndex
CREATE INDEX "HorseAllocation_lessonId_idx" ON "HorseAllocation"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedPlan_horseId_key" ON "FeedPlan"("horseId");

-- CreateIndex
CREATE INDEX "FeedPlan_centreId_idx" ON "FeedPlan"("centreId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_qrCode_key" ON "Asset"("qrCode");

-- CreateIndex
CREATE INDEX "Asset_centreId_status_idx" ON "Asset"("centreId", "status");

-- CreateIndex
CREATE INDEX "Asset_centreId_category_idx" ON "Asset"("centreId", "category");

-- CreateIndex
CREATE INDEX "AssetIssuance_assetId_returnedAt_idx" ON "AssetIssuance"("assetId", "returnedAt");

-- CreateIndex
CREATE INDEX "AssetIssuance_issuedToRiderId_idx" ON "AssetIssuance"("issuedToRiderId");

-- CreateIndex
CREATE INDEX "AssetIssuance_issuedToHorseId_idx" ON "AssetIssuance"("issuedToHorseId");

-- CreateIndex
CREATE INDEX "AssetMaintenance_assetId_repairedAt_idx" ON "AssetMaintenance"("assetId", "repairedAt");

-- CreateIndex
CREATE INDEX "Medicine_centreId_expDate_idx" ON "Medicine"("centreId", "expDate");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_slug_key" ON "Competition"("slug");

-- CreateIndex
CREATE INDEX "Competition_centreId_status_idx" ON "Competition"("centreId", "status");

-- CreateIndex
CREATE INDEX "CompetitionEntry_competitionId_className_idx" ON "CompetitionEntry"("competitionId", "className");

-- CreateIndex
CREATE INDEX "CompetitionEntry_teamId_idx" ON "CompetitionEntry"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionEntry_competitionId_riderId_className_key" ON "CompetitionEntry"("competitionId", "riderId", "className");

-- CreateIndex
CREATE INDEX "CompetitionRound_competitionId_idx" ON "CompetitionRound"("competitionId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionRound_competitionId_className_roundNumber_key" ON "CompetitionRound"("competitionId", "className", "roundNumber");

-- CreateIndex
CREATE INDEX "JumpEffort_roundId_entryId_idx" ON "JumpEffort"("roundId", "entryId");

-- CreateIndex
CREATE INDEX "JumpEffort_entryId_idx" ON "JumpEffort"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "DressageTest_code_key" ON "DressageTest"("code");

-- CreateIndex
CREATE INDEX "DressageScoresheet_entryId_idx" ON "DressageScoresheet"("entryId");

-- CreateIndex
CREATE INDEX "DressageScoresheet_judgeUserId_idx" ON "DressageScoresheet"("judgeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DressageScoresheet_roundId_entryId_judgeUserId_key" ON "DressageScoresheet"("roundId", "entryId", "judgeUserId");

-- CreateIndex
CREATE INDEX "GymkhanaGame_competitionId_className_idx" ON "GymkhanaGame"("competitionId", "className");

-- CreateIndex
CREATE UNIQUE INDEX "GymkhanaGame_competitionId_className_name_key" ON "GymkhanaGame"("competitionId", "className", "name");

-- CreateIndex
CREATE INDEX "GymkhanaResult_entryId_idx" ON "GymkhanaResult"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "GymkhanaResult_gameId_entryId_key" ON "GymkhanaResult"("gameId", "entryId");

-- CreateIndex
CREATE INDEX "CourseFence_roundId_orderIndex_idx" ON "CourseFence"("roundId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "CourseFence_roundId_fenceNo_key" ON "CourseFence"("roundId", "fenceNo");

-- CreateIndex
CREATE INDEX "VetCheck_competitionId_phase_idx" ON "VetCheck"("competitionId", "phase");

-- CreateIndex
CREATE INDEX "StableAllocation_competitionId_idx" ON "StableAllocation"("competitionId");

-- CreateIndex
CREATE UNIQUE INDEX "StableAllocation_competitionId_boxNo_key" ON "StableAllocation"("competitionId", "boxNo");

-- CreateIndex
CREATE INDEX "DrugTest_competitionId_resultStatus_idx" ON "DrugTest"("competitionId", "resultStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DrugTest_competitionId_sampleId_key" ON "DrugTest"("competitionId", "sampleId");

-- CreateIndex
CREATE INDEX "Protest_competitionId_status_idx" ON "Protest"("competitionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalEntry_verifyTokenHash_key" ON "ExternalEntry"("verifyTokenHash");

-- CreateIndex
CREATE INDEX "ExternalEntry_competitionId_status_idx" ON "ExternalEntry"("competitionId", "status");

-- CreateIndex
CREATE INDEX "ExternalEntry_email_idx" ON "ExternalEntry"("email");

-- CreateIndex
CREATE INDEX "TicketTier_competitionId_idx" ON "TicketTier"("competitionId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketTier_competitionId_name_key" ON "TicketTier"("competitionId", "name");

-- CreateIndex
CREATE INDEX "Ticket_competitionId_status_idx" ON "Ticket"("competitionId", "status");

-- CreateIndex
CREATE INDEX "Ticket_groupId_idx" ON "Ticket"("groupId");

-- CreateIndex
CREATE INDEX "Ticket_buyerEmail_idx" ON "Ticket"("buyerEmail");

-- CreateIndex
CREATE INDEX "CompetitionOfficial_competitionId_role_idx" ON "CompetitionOfficial"("competitionId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionOfficial_competitionId_userId_role_key" ON "CompetitionOfficial"("competitionId", "userId", "role");

-- CreateIndex
CREATE INDEX "CompetitionRoundScore_entryId_idx" ON "CompetitionRoundScore"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionRoundScore_roundId_entryId_key" ON "CompetitionRoundScore"("roundId", "entryId");

-- CreateIndex
CREATE UNIQUE INDEX "FeePlan_centreId_levelName_key" ON "FeePlan"("centreId", "levelName");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_serialNo_key" ON "Certificate"("serialNo");

-- CreateIndex
CREATE INDEX "Certificate_examId_idx" ON "Certificate"("examId");

-- CreateIndex
CREATE INDEX "Certificate_competitionId_idx" ON "Certificate"("competitionId");

-- CreateIndex
CREATE INDEX "Certificate_centreId_revokedAt_idx" ON "Certificate"("centreId", "revokedAt");

-- CreateIndex
CREATE INDEX "Certificate_batchTag_idx" ON "Certificate"("batchTag");

-- CreateIndex
CREATE INDEX "ExamLevel_discipline_active_idx" ON "ExamLevel"("discipline", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ExamLevel_discipline_orderIndex_key" ON "ExamLevel"("discipline", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ExamLevel_discipline_code_key" ON "ExamLevel"("discipline", "code");

-- CreateIndex
CREATE INDEX "ScoringTemplate_examLevelId_idx" ON "ScoringTemplate"("examLevelId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringTemplate_centreId_levelKey_key" ON "ScoringTemplate"("centreId", "levelKey");

-- CreateIndex
CREATE INDEX "Exam_centreId_status_idx" ON "Exam"("centreId", "status");

-- CreateIndex
CREATE INDEX "Exam_examinerId_idx" ON "Exam"("examinerId");

-- CreateIndex
CREATE INDEX "Exam_riderId_idx" ON "Exam"("riderId");

-- CreateIndex
CREATE INDEX "Exam_sittingId_idx" ON "Exam"("sittingId");

-- CreateIndex
CREATE INDEX "ExamJudge_judgeId_idx" ON "ExamJudge"("judgeId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamJudge_examId_judgeId_key" ON "ExamJudge"("examId", "judgeId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamJudge_examId_position_key" ON "ExamJudge"("examId", "position");

-- CreateIndex
CREATE INDEX "ExamAttachment_examId_idx" ON "ExamAttachment"("examId");

-- CreateIndex
CREATE INDEX "ExamSitting_centreId_date_idx" ON "ExamSitting"("centreId", "date");

-- CreateIndex
CREATE INDEX "Team_centreId_active_idx" ON "Team"("centreId", "active");

-- CreateIndex
CREATE INDEX "TeamMember_riderId_idx" ON "TeamMember"("riderId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_riderId_key" ON "TeamMember"("teamId", "riderId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_centreId_createdAt_idx" ON "Notification"("centreId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tableName_rowId_idx" ON "AuditLog"("tableName", "rowId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "StaffAttendance_centreId_date_idx" ON "StaffAttendance"("centreId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendance_userId_date_key" ON "StaffAttendance"("userId", "date");

-- CreateIndex
CREATE INDEX "ParentLink_parentUserId_idx" ON "ParentLink"("parentUserId");

-- CreateIndex
CREATE INDEX "ParentLink_riderId_idx" ON "ParentLink"("riderId");

-- CreateIndex
CREATE UNIQUE INDEX "ParentLink_parentUserId_riderId_key" ON "ParentLink"("parentUserId", "riderId");

-- CreateIndex
CREATE INDEX "LeaveRequest_userId_status_idx" ON "LeaveRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_centreId_status_idx" ON "LeaveRequest"("centreId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentCatalog_code_key" ON "EquipmentCatalog"("code");

-- CreateIndex
CREATE INDEX "EquipmentCatalog_category_active_idx" ON "EquipmentCatalog"("category", "active");

-- CreateIndex
CREATE INDEX "EquipmentStock_centreId_idx" ON "EquipmentStock"("centreId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentStock_centreId_catalogId_key" ON "EquipmentStock"("centreId", "catalogId");

-- CreateIndex
CREATE INDEX "EquipmentStockMovement_stockId_at_idx" ON "EquipmentStockMovement"("stockId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_centreId_status_idx" ON "Event"("centreId", "status");

-- CreateIndex
CREATE INDEX "Event_startDate_idx" ON "Event"("startDate");

-- CreateIndex
CREATE INDEX "EventRegistration_eventId_status_idx" ON "EventRegistration"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_eventId_riderId_key" ON "EventRegistration"("eventId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_code_key" ON "ExpenseCategory"("code");

-- CreateIndex
CREATE INDEX "Vendor_centreId_active_idx" ON "Vendor"("centreId", "active");

-- CreateIndex
CREATE INDEX "Expense_centreId_spentAt_idx" ON "Expense"("centreId", "spentAt");

-- CreateIndex
CREATE INDEX "Expense_categoryId_idx" ON "Expense"("categoryId");

-- CreateIndex
CREATE INDEX "Accreditation_riderId_status_idx" ON "Accreditation"("riderId", "status");

-- CreateIndex
CREATE INDEX "Accreditation_body_level_idx" ON "Accreditation"("body", "level");

-- AddForeignKey
ALTER TABLE "OrgFeature" ADD CONSTRAINT "OrgFeature_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementDismissal" ADD CONSTRAINT "AnnouncementDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementDismissal" ADD CONSTRAINT "AnnouncementDismissal_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpsResponse" ADD CONSTRAINT "NpsResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasInvoice" ADD CONSTRAINT "SaasInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Centre" ADD CONSTRAINT "Centre_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerifyToken" ADD CONSTRAINT "EmailVerifyToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPasswordResetToken" ADD CONSTRAINT "OwnerPasswordResetToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressLevel" ADD CONSTRAINT "ProgressLevel_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "ProgressLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSkillStatus" ADD CONSTRAINT "RiderSkillStatus_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSkillStatus" ADD CONSTRAINT "RiderSkillStatus_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "ProgressLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Horse" ADD CONSTRAINT "Horse_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrolment" ADD CONSTRAINT "CourseEnrolment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCertification" ADD CONSTRAINT "StaffCertification_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumableMovement" ADD CONSTRAINT "ConsumableMovement_consumableId_fkey" FOREIGN KEY ("consumableId") REFERENCES "Consumable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StartListEntry" ADD CONSTRAINT "StartListEntry_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StartListEntry" ADD CONSTRAINT "StartListEntry_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CompetitionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeAward" ADD CONSTRAINT "PrizeAward_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeAward" ADD CONSTRAINT "PrizeAward_sponsoredById_fkey" FOREIGN KEY ("sponsoredById") REFERENCES "Sponsor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sponsor" ADD CONSTRAINT "Sponsor_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarrierVisit" ADD CONSTRAINT "FarrierVisit_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorseHealthLog" ADD CONSTRAINT "HorseHealthLog_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InjuryLog" ADD CONSTRAINT "InjuryLog_horseSubjectId_fkey" FOREIGN KEY ("horseSubjectId") REFERENCES "Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccinationSchedule" ADD CONSTRAINT "VaccinationSchedule_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorseAllocation" ADD CONSTRAINT "HorseAllocation_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorseAllocation" ADD CONSTRAINT "HorseAllocation_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorseAllocation" ADD CONSTRAINT "HorseAllocation_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPlan" ADD CONSTRAINT "FeedPlan_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPlan" ADD CONSTRAINT "FeedPlan_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMaintenance" ADD CONSTRAINT "AssetMaintenance_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineUsage" ADD CONSTRAINT "MedicineUsage_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineUsage" ADD CONSTRAINT "MedicineUsage_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionRound" ADD CONSTRAINT "CompetitionRound_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionRound" ADD CONSTRAINT "CompetitionRound_dressageTestId_fkey" FOREIGN KEY ("dressageTestId") REFERENCES "DressageTest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JumpEffort" ADD CONSTRAINT "JumpEffort_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CompetitionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DressageScoresheet" ADD CONSTRAINT "DressageScoresheet_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CompetitionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DressageScoresheet" ADD CONSTRAINT "DressageScoresheet_testId_fkey" FOREIGN KEY ("testId") REFERENCES "DressageTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymkhanaGame" ADD CONSTRAINT "GymkhanaGame_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymkhanaResult" ADD CONSTRAINT "GymkhanaResult_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "GymkhanaGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymkhanaResult" ADD CONSTRAINT "GymkhanaResult_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CompetitionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseFence" ADD CONSTRAINT "CourseFence_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CompetitionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VetCheck" ADD CONSTRAINT "VetCheck_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VetCheck" ADD CONSTRAINT "VetCheck_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StableAllocation" ADD CONSTRAINT "StableAllocation_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugTest" ADD CONSTRAINT "DrugTest_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protest" ADD CONSTRAINT "Protest_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalEntry" ADD CONSTRAINT "ExternalEntry_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTier" ADD CONSTRAINT "TicketTier_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "TicketTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionOfficial" ADD CONSTRAINT "CompetitionOfficial_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionRoundScore" ADD CONSTRAINT "CompetitionRoundScore_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CompetitionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionRoundScore" ADD CONSTRAINT "CompetitionRoundScore_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CompetitionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringTemplate" ADD CONSTRAINT "ScoringTemplate_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringTemplate" ADD CONSTRAINT "ScoringTemplate_examLevelId_fkey" FOREIGN KEY ("examLevelId") REFERENCES "ExamLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_previousExamId_fkey" FOREIGN KEY ("previousExamId") REFERENCES "Exam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_sittingId_fkey" FOREIGN KEY ("sittingId") REFERENCES "ExamSitting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamJudge" ADD CONSTRAINT "ExamJudge_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttachment" ADD CONSTRAINT "ExamAttachment_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSitting" ADD CONSTRAINT "ExamSitting_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentLink" ADD CONSTRAINT "ParentLink_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentLink" ADD CONSTRAINT "ParentLink_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentStock" ADD CONSTRAINT "EquipmentStock_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentStock" ADD CONSTRAINT "EquipmentStock_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "EquipmentCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentStockMovement" ADD CONSTRAINT "EquipmentStockMovement_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "EquipmentStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accreditation" ADD CONSTRAINT "Accreditation_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- -------------------------------------------------------------------
-- SECTION 2 — PLATFORM SEEDS
-- These rows the app would otherwise lazy-create on first access; we
-- seed them up-front so the very first request to /pricing or
-- /owner/billing renders correctly.
-- -------------------------------------------------------------------

-- PlatformBillingConfig — singleton row. Update via /owner/billing UI.
-- All identifying fields stay blank; the owner fills them post-deploy.
INSERT INTO "PlatformBillingConfig" (id, "updatedAt")
VALUES ('default', now())
ON CONFLICT (id) DO NOTHING;

-- PlatformPricing — three commercial tiers. Numbers below are
-- placeholders (₹2,999 / ₹5,999 / ₹11,999). Update via /owner/pricing
-- once you've decided the real rates.
INSERT INTO "PlatformPricing"
  (key, label, tagline, "monthlyInr", "annualInrPerMonth", highlight, "isVisible", "sortOrder", "updatedAt")
VALUES
  ('starter',    'Starter',    'Single-centre clubs running the core workflow.', 2999, 2499, false, true, 1, now()),
  ('pro',        'Pro',        'Growing multi-centre academies with parents + vets.', 5999, 4999, true,  true, 2, now()),
  ('enterprise', 'Enterprise', 'Federation-level chains running competitions + HQ rollup.', 11999, 9999, false, true, 3, now())
ON CONFLICT (key) DO NOTHING;

-- DressageTest catalog — three FEI-style placeholder tests. SUPER_ADMIN
-- overwrites these with the real EFI tests via /api/dressage-tests once
-- the app is running.
INSERT INTO "DressageTest"
  (id, code, name, level, body, "movementsJson", "collectiveMarksJson", "maxScore", active, "updatedAt")
VALUES
  ('seed_prelim_14', 'PRELIM_14', 'Preliminary 14 (sample)', 'preliminary', 'custom',
    '[{"no":1,"letter":"A","description":"Enter working trot rising","coefficient":1},{"no":2,"letter":"X","description":"Halt, salute","coefficient":1},{"no":3,"letter":"C","description":"Track left, working trot rising","coefficient":1},{"no":4,"letter":"E","description":"Half-20m circle","coefficient":1},{"no":5,"letter":"A","description":"Working canter left lead","coefficient":1},{"no":6,"letter":"B","description":"Half-circle 15m","coefficient":1},{"no":7,"letter":"C","description":"Working trot","coefficient":1},{"no":8,"letter":"M","description":"Working canter right lead","coefficient":1},{"no":9,"letter":"F","description":"Working trot rising","coefficient":1},{"no":10,"letter":"A","description":"Down centre line, working trot","coefficient":1},{"no":11,"letter":"X","description":"Halt, salute","coefficient":1},{"no":12,"letter":"—","description":"Walks (free walk on a long rein)","coefficient":2},{"no":13,"letter":"—","description":"Transitions","coefficient":1},{"no":14,"letter":"—","description":"Accuracy of figures","coefficient":1}]',
    '[{"name":"Paces","coefficient":1},{"name":"Impulsion","coefficient":1},{"name":"Submission","coefficient":1},{"name":"Rider position + seat","coefficient":1}]',
    190, true, now()),
  ('seed_novice_27', 'NOVICE_27', 'Novice 27 (placeholder)', 'novice', 'custom',
    '[{"no":1,"letter":"—","description":"Movement 1 (please customise)","coefficient":1},{"no":2,"letter":"—","description":"Movement 2 (please customise)","coefficient":1},{"no":3,"letter":"—","description":"Movement 3 (please customise)","coefficient":1},{"no":4,"letter":"—","description":"Movement 4 (please customise)","coefficient":1},{"no":5,"letter":"—","description":"Movement 5 (please customise)","coefficient":1},{"no":6,"letter":"—","description":"Movement 6 (please customise)","coefficient":1},{"no":7,"letter":"—","description":"Movement 7 (please customise)","coefficient":1},{"no":8,"letter":"—","description":"Movement 8 (please customise)","coefficient":1},{"no":9,"letter":"—","description":"Movement 9 (please customise)","coefficient":1},{"no":10,"letter":"—","description":"Movement 10 (please customise)","coefficient":1},{"no":11,"letter":"—","description":"Movement 11 (please customise)","coefficient":1},{"no":12,"letter":"—","description":"Movement 12 (please customise)","coefficient":1},{"no":13,"letter":"—","description":"Movement 13 (please customise)","coefficient":1},{"no":14,"letter":"—","description":"Movement 14 (please customise)","coefficient":1},{"no":15,"letter":"—","description":"Movement 15 (please customise)","coefficient":1},{"no":16,"letter":"—","description":"Movement 16 (please customise)","coefficient":1},{"no":17,"letter":"—","description":"Movement 17 (please customise)","coefficient":1},{"no":18,"letter":"—","description":"Movement 18 (please customise)","coefficient":1},{"no":19,"letter":"—","description":"Movement 19 (please customise)","coefficient":1},{"no":20,"letter":"—","description":"Movement 20 (please customise)","coefficient":1}]',
    '[{"name":"Paces","coefficient":1},{"name":"Impulsion","coefficient":1},{"name":"Submission","coefficient":1},{"name":"Rider position + seat","coefficient":1}]',
    240, true, now()),
  ('seed_elem_43', 'ELEMENTARY_43', 'Elementary 43 (placeholder)', 'elementary', 'custom',
    '[{"no":1,"letter":"—","description":"Movement 1 (please customise)","coefficient":1},{"no":2,"letter":"—","description":"Movement 2 (please customise)","coefficient":1},{"no":3,"letter":"—","description":"Movement 3 (please customise)","coefficient":1},{"no":4,"letter":"—","description":"Movement 4 (please customise)","coefficient":1},{"no":5,"letter":"—","description":"Movement 5 (please customise)","coefficient":1},{"no":6,"letter":"—","description":"Movement 6 (please customise)","coefficient":1},{"no":7,"letter":"—","description":"Movement 7 (please customise)","coefficient":1},{"no":8,"letter":"—","description":"Movement 8 (please customise)","coefficient":1},{"no":9,"letter":"—","description":"Movement 9 (please customise)","coefficient":1},{"no":10,"letter":"—","description":"Movement 10 (please customise)","coefficient":1},{"no":11,"letter":"—","description":"Movement 11 (please customise)","coefficient":1},{"no":12,"letter":"—","description":"Movement 12 (please customise)","coefficient":1},{"no":13,"letter":"—","description":"Movement 13 (please customise)","coefficient":1},{"no":14,"letter":"—","description":"Movement 14 (please customise)","coefficient":1},{"no":15,"letter":"—","description":"Movement 15 (please customise)","coefficient":1},{"no":16,"letter":"—","description":"Movement 16 (please customise)","coefficient":1},{"no":17,"letter":"—","description":"Movement 17 (please customise)","coefficient":1},{"no":18,"letter":"—","description":"Movement 18 (please customise)","coefficient":1},{"no":19,"letter":"—","description":"Movement 19 (please customise)","coefficient":1},{"no":20,"letter":"—","description":"Movement 20 (please customise)","coefficient":1},{"no":21,"letter":"—","description":"Movement 21 (please customise)","coefficient":1},{"no":22,"letter":"—","description":"Movement 22 (please customise)","coefficient":1},{"no":23,"letter":"—","description":"Movement 23 (please customise)","coefficient":1},{"no":24,"letter":"—","description":"Movement 24 (please customise)","coefficient":1}]',
    '[{"name":"Paces","coefficient":1},{"name":"Impulsion","coefficient":1},{"name":"Submission","coefficient":1},{"name":"Rider position + seat","coefficient":1}]',
    280, true, now())
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- -------------------------------------------------------------------
-- SECTION 3 — VERIFICATION
-- Run these after the BEGIN/COMMIT above. Each query returns a single
-- row; eyeball the numbers.
-- -------------------------------------------------------------------

SELECT '✓ tables'   AS check, count(*) AS public_tables FROM pg_tables WHERE schemaname = 'public';
SELECT '✓ indexes'  AS check, count(*) AS public_indexes FROM pg_indexes WHERE schemaname = 'public';
SELECT '✓ fkeys'    AS check, count(*) AS foreign_keys
FROM information_schema.table_constraints
WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY';

SELECT '✓ seeds'    AS check,
  (SELECT count(*) FROM "PlatformBillingConfig") AS billing_config_rows,
  (SELECT count(*) FROM "PlatformPricing")       AS pricing_tiers,
  (SELECT count(*) FROM "DressageTest")          AS dressage_tests;

SELECT 'Production setup complete.' AS result;
