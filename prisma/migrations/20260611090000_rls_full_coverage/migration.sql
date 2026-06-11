-- Full-coverage RLS org-isolation (supersedes #99's 47-table policies).
-- DORMANT until app.rls_enforce='on' (set only when RLS_ENFORCE=1). Every table
-- gets ENABLE+FORCE+policy so a NOBYPASSRLS app role (app_rls) can run the whole
-- app: org-isolated when enforced, sees-all when off, fail-closed with no org.
--
-- The SECURITY DEFINER helper (owned by the migration runner = postgres) reads
-- Centre WITHOUT being subject to RLS, breaking the policy-subquery recursion
-- that made the #99 policies return 0 rows for a non-bypass role.

CREATE OR REPLACE FUNCTION app_centre_ids() RETURNS text[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(id), '{}') FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true)
$$;
GRANT EXECUTE ON FUNCTION app_centre_ids() TO PUBLIC;

-- Organisation  [global]
ALTER TABLE "Organisation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organisation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Organisation_org_isolation" ON "Organisation";
CREATE POLICY "Organisation_org_isolation" ON "Organisation" FOR ALL
  USING (true)
  WITH CHECK (true);

-- LegalText  [orgId]
ALTER TABLE "LegalText" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalText" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "LegalText_org_isolation" ON "LegalText";
CREATE POLICY "LegalText_org_isolation" ON "LegalText" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true));

-- ChecklistTemplate  [centreId]
ALTER TABLE "ChecklistTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ChecklistTemplate_org_isolation" ON "ChecklistTemplate";
CREATE POLICY "ChecklistTemplate_org_isolation" ON "ChecklistTemplate" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- ChecklistItem  [via-fk(ChecklistTemplate.templateId)]
ALTER TABLE "ChecklistItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ChecklistItem_org_isolation" ON "ChecklistItem";
CREATE POLICY "ChecklistItem_org_isolation" ON "ChecklistItem" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "ChecklistTemplate" p WHERE p."id" = "ChecklistItem"."templateId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "ChecklistTemplate" p WHERE p."id" = "ChecklistItem"."templateId"));

-- ChecklistSubmission  [centreId]
ALTER TABLE "ChecklistSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistSubmission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ChecklistSubmission_org_isolation" ON "ChecklistSubmission";
CREATE POLICY "ChecklistSubmission_org_isolation" ON "ChecklistSubmission" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- ChecklistSubmissionItem  [via-fk(ChecklistSubmission.submissionId)]
ALTER TABLE "ChecklistSubmissionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistSubmissionItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ChecklistSubmissionItem_org_isolation" ON "ChecklistSubmissionItem";
CREATE POLICY "ChecklistSubmissionItem_org_isolation" ON "ChecklistSubmissionItem" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "ChecklistSubmission" p WHERE p."id" = "ChecklistSubmissionItem"."submissionId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "ChecklistSubmission" p WHERE p."id" = "ChecklistSubmissionItem"."submissionId"));

-- DewormingSchedule  [via-fk(Horse.horseId)]
ALTER TABLE "DewormingSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DewormingSchedule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "DewormingSchedule_org_isolation" ON "DewormingSchedule";
CREATE POLICY "DewormingSchedule_org_isolation" ON "DewormingSchedule" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Horse" p WHERE p."id" = "DewormingSchedule"."horseId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Horse" p WHERE p."id" = "DewormingSchedule"."horseId"));

-- MonthlySkillCatalog  [centreId]
ALTER TABLE "MonthlySkillCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlySkillCatalog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "MonthlySkillCatalog_org_isolation" ON "MonthlySkillCatalog";
CREATE POLICY "MonthlySkillCatalog_org_isolation" ON "MonthlySkillCatalog" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- MonthlySkillMark  [via-fk(MonthlySkillCatalog.catalogId)]
ALTER TABLE "MonthlySkillMark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlySkillMark" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "MonthlySkillMark_org_isolation" ON "MonthlySkillMark";
CREATE POLICY "MonthlySkillMark_org_isolation" ON "MonthlySkillMark" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "MonthlySkillCatalog" p WHERE p."id" = "MonthlySkillMark"."catalogId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "MonthlySkillCatalog" p WHERE p."id" = "MonthlySkillMark"."catalogId"));

-- EmployeeAdvance  [centreId]
ALTER TABLE "EmployeeAdvance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeAdvance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EmployeeAdvance_org_isolation" ON "EmployeeAdvance";
CREATE POLICY "EmployeeAdvance_org_isolation" ON "EmployeeAdvance" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- AdvanceRepayment  [via-fk(EmployeeAdvance.advanceId)]
ALTER TABLE "AdvanceRepayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdvanceRepayment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AdvanceRepayment_org_isolation" ON "AdvanceRepayment";
CREATE POLICY "AdvanceRepayment_org_isolation" ON "AdvanceRepayment" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "EmployeeAdvance" p WHERE p."id" = "AdvanceRepayment"."advanceId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "EmployeeAdvance" p WHERE p."id" = "AdvanceRepayment"."advanceId"));

-- SeparationNotice  [centreId-null]
ALTER TABLE "SeparationNotice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SeparationNotice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SeparationNotice_org_isolation" ON "SeparationNotice";
CREATE POLICY "SeparationNotice_org_isolation" ON "SeparationNotice" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" IS NULL OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" IS NULL OR "centreId" = ANY(app_centre_ids()));

-- OrgFeature  [orgId]
ALTER TABLE "OrgFeature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgFeature" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "OrgFeature_org_isolation" ON "OrgFeature";
CREATE POLICY "OrgFeature_org_isolation" ON "OrgFeature" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true));

-- PlatformPricing  [global]
ALTER TABLE "PlatformPricing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformPricing" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PlatformPricing_org_isolation" ON "PlatformPricing";
CREATE POLICY "PlatformPricing_org_isolation" ON "PlatformPricing" FOR ALL
  USING (true)
  WITH CHECK (true);

-- PlatformBillingConfig  [global]
ALTER TABLE "PlatformBillingConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformBillingConfig" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PlatformBillingConfig_org_isolation" ON "PlatformBillingConfig";
CREATE POLICY "PlatformBillingConfig_org_isolation" ON "PlatformBillingConfig" FOR ALL
  USING (true)
  WITH CHECK (true);

-- Announcement  [global]
ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Announcement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Announcement_org_isolation" ON "Announcement";
CREATE POLICY "Announcement_org_isolation" ON "Announcement" FOR ALL
  USING (true)
  WITH CHECK (true);

-- AnnouncementDismissal  [global]
ALTER TABLE "AnnouncementDismissal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnnouncementDismissal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AnnouncementDismissal_org_isolation" ON "AnnouncementDismissal";
CREATE POLICY "AnnouncementDismissal_org_isolation" ON "AnnouncementDismissal" FOR ALL
  USING (true)
  WITH CHECK (true);

-- NpsResponse  [orgId]
ALTER TABLE "NpsResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NpsResponse" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "NpsResponse_org_isolation" ON "NpsResponse";
CREATE POLICY "NpsResponse_org_isolation" ON "NpsResponse" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true));

-- SaasInvoice  [orgId]
ALTER TABLE "SaasInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaasInvoice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SaasInvoice_org_isolation" ON "SaasInvoice";
CREATE POLICY "SaasInvoice_org_isolation" ON "SaasInvoice" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true));

-- PlatformUser  [global]
ALTER TABLE "PlatformUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformUser" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PlatformUser_org_isolation" ON "PlatformUser";
CREATE POLICY "PlatformUser_org_isolation" ON "PlatformUser" FOR ALL
  USING (true)
  WITH CHECK (true);

-- PlatformAuditLog  [orgId]
ALTER TABLE "PlatformAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformAuditLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PlatformAuditLog_org_isolation" ON "PlatformAuditLog";
CREATE POLICY "PlatformAuditLog_org_isolation" ON "PlatformAuditLog" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true));

-- Centre  [global]
ALTER TABLE "Centre" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Centre" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Centre_org_isolation" ON "Centre";
CREATE POLICY "Centre_org_isolation" ON "Centre" FOR ALL
  USING (true)
  WITH CHECK (true);

-- User  [global]
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User_org_isolation" ON "User";
CREATE POLICY "User_org_isolation" ON "User" FOR ALL
  USING (true)
  WITH CHECK (true);

-- PasswordResetToken  [global]
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PasswordResetToken_org_isolation" ON "PasswordResetToken";
CREATE POLICY "PasswordResetToken_org_isolation" ON "PasswordResetToken" FOR ALL
  USING (true)
  WITH CHECK (true);

-- EmailVerifyToken  [global]
ALTER TABLE "EmailVerifyToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailVerifyToken" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EmailVerifyToken_org_isolation" ON "EmailVerifyToken";
CREATE POLICY "EmailVerifyToken_org_isolation" ON "EmailVerifyToken" FOR ALL
  USING (true)
  WITH CHECK (true);

-- OwnerPasswordResetToken  [global]
ALTER TABLE "OwnerPasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OwnerPasswordResetToken" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "OwnerPasswordResetToken_org_isolation" ON "OwnerPasswordResetToken";
CREATE POLICY "OwnerPasswordResetToken_org_isolation" ON "OwnerPasswordResetToken" FOR ALL
  USING (true)
  WITH CHECK (true);

-- Rider  [centreId]
ALTER TABLE "Rider" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Rider" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Rider_org_isolation" ON "Rider";
CREATE POLICY "Rider_org_isolation" ON "Rider" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Batch  [centreId]
ALTER TABLE "Batch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Batch" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Batch_org_isolation" ON "Batch";
CREATE POLICY "Batch_org_isolation" ON "Batch" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Attendance  [via-fk(Rider.riderId)]
ALTER TABLE "Attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Attendance_org_isolation" ON "Attendance";
CREATE POLICY "Attendance_org_isolation" ON "Attendance" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Rider" p WHERE p."id" = "Attendance"."riderId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Rider" p WHERE p."id" = "Attendance"."riderId"));

-- Lesson  [centreId]
ALTER TABLE "Lesson" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lesson" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lesson_org_isolation" ON "Lesson";
CREATE POLICY "Lesson_org_isolation" ON "Lesson" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- ProgressLevel  [centreId]
ALTER TABLE "ProgressLevel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProgressLevel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ProgressLevel_org_isolation" ON "ProgressLevel";
CREATE POLICY "ProgressLevel_org_isolation" ON "ProgressLevel" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Skill  [global]
ALTER TABLE "Skill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Skill" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Skill_org_isolation" ON "Skill";
CREATE POLICY "Skill_org_isolation" ON "Skill" FOR ALL
  USING (true)
  WITH CHECK (true);

-- RiderSkillStatus  [via-fk(Rider.riderId)]
ALTER TABLE "RiderSkillStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RiderSkillStatus" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "RiderSkillStatus_org_isolation" ON "RiderSkillStatus";
CREATE POLICY "RiderSkillStatus_org_isolation" ON "RiderSkillStatus" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Rider" p WHERE p."id" = "RiderSkillStatus"."riderId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Rider" p WHERE p."id" = "RiderSkillStatus"."riderId"));

-- Assessment  [centreId]
ALTER TABLE "Assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Assessment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Assessment_org_isolation" ON "Assessment";
CREATE POLICY "Assessment_org_isolation" ON "Assessment" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Staff  [centreId]
ALTER TABLE "Staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Staff" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff_org_isolation" ON "Staff";
CREATE POLICY "Staff_org_isolation" ON "Staff" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- EmployeeOnboarding  [centreId]
ALTER TABLE "EmployeeOnboarding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeOnboarding" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EmployeeOnboarding_org_isolation" ON "EmployeeOnboarding";
CREATE POLICY "EmployeeOnboarding_org_isolation" ON "EmployeeOnboarding" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Horse  [centreId]
ALTER TABLE "Horse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Horse" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Horse_org_isolation" ON "Horse";
CREATE POLICY "Horse_org_isolation" ON "Horse" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- HorseTest  [via-fk(Horse.horseId)]
ALTER TABLE "HorseTest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HorseTest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "HorseTest_org_isolation" ON "HorseTest";
CREATE POLICY "HorseTest_org_isolation" ON "HorseTest" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Horse" p WHERE p."id" = "HorseTest"."horseId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Horse" p WHERE p."id" = "HorseTest"."horseId"));

-- Course  [centreId]
ALTER TABLE "Course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Course" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Course_org_isolation" ON "Course";
CREATE POLICY "Course_org_isolation" ON "Course" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- CourseEnrolment  [via-fk(Course.courseId)]
ALTER TABLE "CourseEnrolment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CourseEnrolment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "CourseEnrolment_org_isolation" ON "CourseEnrolment";
CREATE POLICY "CourseEnrolment_org_isolation" ON "CourseEnrolment" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Course" p WHERE p."id" = "CourseEnrolment"."courseId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Course" p WHERE p."id" = "CourseEnrolment"."courseId"));

-- StaffCertification  [centreId]
ALTER TABLE "StaffCertification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffCertification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "StaffCertification_org_isolation" ON "StaffCertification";
CREATE POLICY "StaffCertification_org_isolation" ON "StaffCertification" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- FacilityBooking  [centreId]
ALTER TABLE "FacilityBooking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FacilityBooking" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "FacilityBooking_org_isolation" ON "FacilityBooking";
CREATE POLICY "FacilityBooking_org_isolation" ON "FacilityBooking" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- ApprovalRequest  [centreId]
ALTER TABLE "ApprovalRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApprovalRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ApprovalRequest_org_isolation" ON "ApprovalRequest";
CREATE POLICY "ApprovalRequest_org_isolation" ON "ApprovalRequest" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Consumable  [centreId]
ALTER TABLE "Consumable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Consumable" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Consumable_org_isolation" ON "Consumable";
CREATE POLICY "Consumable_org_isolation" ON "Consumable" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- ConsumableMovement  [via-fk(Consumable.consumableId)]
ALTER TABLE "ConsumableMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsumableMovement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ConsumableMovement_org_isolation" ON "ConsumableMovement";
CREATE POLICY "ConsumableMovement_org_isolation" ON "ConsumableMovement" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Consumable" p WHERE p."id" = "ConsumableMovement"."consumableId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Consumable" p WHERE p."id" = "ConsumableMovement"."consumableId"));

-- FarrierVisit  [centreId]
ALTER TABLE "FarrierVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FarrierVisit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "FarrierVisit_org_isolation" ON "FarrierVisit";
CREATE POLICY "FarrierVisit_org_isolation" ON "FarrierVisit" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- HorseHealthLog  [centreId]
ALTER TABLE "HorseHealthLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HorseHealthLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "HorseHealthLog_org_isolation" ON "HorseHealthLog";
CREATE POLICY "HorseHealthLog_org_isolation" ON "HorseHealthLog" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- InjuryLog  [centreId]
ALTER TABLE "InjuryLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InjuryLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "InjuryLog_org_isolation" ON "InjuryLog";
CREATE POLICY "InjuryLog_org_isolation" ON "InjuryLog" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- VaccinationSchedule  [centreId]
ALTER TABLE "VaccinationSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VaccinationSchedule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VaccinationSchedule_org_isolation" ON "VaccinationSchedule";
CREATE POLICY "VaccinationSchedule_org_isolation" ON "VaccinationSchedule" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- HorseAllocation  [via-fk(Horse.horseId)]
ALTER TABLE "HorseAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HorseAllocation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "HorseAllocation_org_isolation" ON "HorseAllocation";
CREATE POLICY "HorseAllocation_org_isolation" ON "HorseAllocation" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Horse" p WHERE p."id" = "HorseAllocation"."horseId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Horse" p WHERE p."id" = "HorseAllocation"."horseId"));

-- FeedPlan  [centreId]
ALTER TABLE "FeedPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedPlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "FeedPlan_org_isolation" ON "FeedPlan";
CREATE POLICY "FeedPlan_org_isolation" ON "FeedPlan" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Facility  [centreId]
ALTER TABLE "Facility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Facility" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Facility_org_isolation" ON "Facility";
CREATE POLICY "Facility_org_isolation" ON "Facility" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Medicine  [centreId]
ALTER TABLE "Medicine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Medicine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Medicine_org_isolation" ON "Medicine";
CREATE POLICY "Medicine_org_isolation" ON "Medicine" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- MedicineUsage  [via-fk(Medicine.medicineId)]
ALTER TABLE "MedicineUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MedicineUsage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "MedicineUsage_org_isolation" ON "MedicineUsage";
CREATE POLICY "MedicineUsage_org_isolation" ON "MedicineUsage" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Medicine" p WHERE p."id" = "MedicineUsage"."medicineId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Medicine" p WHERE p."id" = "MedicineUsage"."medicineId"));

-- VetVisit  [centreId]
ALTER TABLE "VetVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VetVisit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VetVisit_org_isolation" ON "VetVisit";
CREATE POLICY "VetVisit_org_isolation" ON "VetVisit" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- VetPrescription  [via-fk(VetVisit.visitId)]
ALTER TABLE "VetPrescription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VetPrescription" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VetPrescription_org_isolation" ON "VetPrescription";
CREATE POLICY "VetPrescription_org_isolation" ON "VetPrescription" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "VetVisit" p WHERE p."id" = "VetPrescription"."visitId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "VetVisit" p WHERE p."id" = "VetPrescription"."visitId"));

-- Task  [centreId]
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Task_org_isolation" ON "Task";
CREATE POLICY "Task_org_isolation" ON "Task" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- FeePlan  [centreId]
ALTER TABLE "FeePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeePlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "FeePlan_org_isolation" ON "FeePlan";
CREATE POLICY "FeePlan_org_isolation" ON "FeePlan" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Invoice  [centreId]
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Invoice_org_isolation" ON "Invoice";
CREATE POLICY "Invoice_org_isolation" ON "Invoice" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Payment  [via-fk(Invoice.invoiceId)]
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Payment_org_isolation" ON "Payment";
CREATE POLICY "Payment_org_isolation" ON "Payment" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Invoice" p WHERE p."id" = "Payment"."invoiceId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Invoice" p WHERE p."id" = "Payment"."invoiceId"));

-- Certificate  [centreId]
ALTER TABLE "Certificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Certificate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Certificate_org_isolation" ON "Certificate";
CREATE POLICY "Certificate_org_isolation" ON "Certificate" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- ExamLevel  [global]
ALTER TABLE "ExamLevel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamLevel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExamLevel_org_isolation" ON "ExamLevel";
CREATE POLICY "ExamLevel_org_isolation" ON "ExamLevel" FOR ALL
  USING (true)
  WITH CHECK (true);

-- ScoringTemplate  [centreId]
ALTER TABLE "ScoringTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScoringTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ScoringTemplate_org_isolation" ON "ScoringTemplate";
CREATE POLICY "ScoringTemplate_org_isolation" ON "ScoringTemplate" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Exam  [centreId]
ALTER TABLE "Exam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Exam" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Exam_org_isolation" ON "Exam";
CREATE POLICY "Exam_org_isolation" ON "Exam" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- ExamJudge  [via-fk(Exam.examId)]
ALTER TABLE "ExamJudge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamJudge" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExamJudge_org_isolation" ON "ExamJudge";
CREATE POLICY "ExamJudge_org_isolation" ON "ExamJudge" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Exam" p WHERE p."id" = "ExamJudge"."examId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Exam" p WHERE p."id" = "ExamJudge"."examId"));

-- ExamAttachment  [via-fk(Exam.examId)]
ALTER TABLE "ExamAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamAttachment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExamAttachment_org_isolation" ON "ExamAttachment";
CREATE POLICY "ExamAttachment_org_isolation" ON "ExamAttachment" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Exam" p WHERE p."id" = "ExamAttachment"."examId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Exam" p WHERE p."id" = "ExamAttachment"."examId"));

-- ExamSitting  [centreId]
ALTER TABLE "ExamSitting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamSitting" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExamSitting_org_isolation" ON "ExamSitting";
CREATE POLICY "ExamSitting_org_isolation" ON "ExamSitting" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- ExamSittingExaminer  [via-fk(ExamSitting.sittingId)]
ALTER TABLE "ExamSittingExaminer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamSittingExaminer" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExamSittingExaminer_org_isolation" ON "ExamSittingExaminer";
CREATE POLICY "ExamSittingExaminer_org_isolation" ON "ExamSittingExaminer" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "ExamSitting" p WHERE p."id" = "ExamSittingExaminer"."sittingId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "ExamSitting" p WHERE p."id" = "ExamSittingExaminer"."sittingId"));

-- Team  [centreId]
ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Team" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Team_org_isolation" ON "Team";
CREATE POLICY "Team_org_isolation" ON "Team" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- TeamMember  [via-fk(Team.teamId)]
ALTER TABLE "TeamMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamMember" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TeamMember_org_isolation" ON "TeamMember";
CREATE POLICY "TeamMember_org_isolation" ON "TeamMember" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Team" p WHERE p."id" = "TeamMember"."teamId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Team" p WHERE p."id" = "TeamMember"."teamId"));

-- Notification  [centreId-null]
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Notification_org_isolation" ON "Notification";
CREATE POLICY "Notification_org_isolation" ON "Notification" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" IS NULL OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" IS NULL OR "centreId" = ANY(app_centre_ids()));

-- AuditLog  [global]
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AuditLog_org_isolation" ON "AuditLog";
CREATE POLICY "AuditLog_org_isolation" ON "AuditLog" FOR ALL
  USING (true)
  WITH CHECK (true);

-- StaffAttendance  [centreId]
ALTER TABLE "StaffAttendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffAttendance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "StaffAttendance_org_isolation" ON "StaffAttendance";
CREATE POLICY "StaffAttendance_org_isolation" ON "StaffAttendance" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- ParentLink  [via-fk(Rider.riderId)]
ALTER TABLE "ParentLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParentLink" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ParentLink_org_isolation" ON "ParentLink";
CREATE POLICY "ParentLink_org_isolation" ON "ParentLink" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Rider" p WHERE p."id" = "ParentLink"."riderId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Rider" p WHERE p."id" = "ParentLink"."riderId"));

-- LeaveRequest  [centreId]
ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "LeaveRequest_org_isolation" ON "LeaveRequest";
CREATE POLICY "LeaveRequest_org_isolation" ON "LeaveRequest" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- EquipmentCatalog  [global]
ALTER TABLE "EquipmentCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EquipmentCatalog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EquipmentCatalog_org_isolation" ON "EquipmentCatalog";
CREATE POLICY "EquipmentCatalog_org_isolation" ON "EquipmentCatalog" FOR ALL
  USING (true)
  WITH CHECK (true);

-- EquipmentStock  [centreId]
ALTER TABLE "EquipmentStock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EquipmentStock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EquipmentStock_org_isolation" ON "EquipmentStock";
CREATE POLICY "EquipmentStock_org_isolation" ON "EquipmentStock" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- EquipmentStockMovement  [via-fk(EquipmentStock.stockId)]
ALTER TABLE "EquipmentStockMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EquipmentStockMovement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EquipmentStockMovement_org_isolation" ON "EquipmentStockMovement";
CREATE POLICY "EquipmentStockMovement_org_isolation" ON "EquipmentStockMovement" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "EquipmentStock" p WHERE p."id" = "EquipmentStockMovement"."stockId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "EquipmentStock" p WHERE p."id" = "EquipmentStockMovement"."stockId"));

-- Event  [centreId]
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Event_org_isolation" ON "Event";
CREATE POLICY "Event_org_isolation" ON "Event" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- EventRegistration  [via-fk(Event.eventId)]
ALTER TABLE "EventRegistration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventRegistration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EventRegistration_org_isolation" ON "EventRegistration";
CREATE POLICY "EventRegistration_org_isolation" ON "EventRegistration" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Event" p WHERE p."id" = "EventRegistration"."eventId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Event" p WHERE p."id" = "EventRegistration"."eventId"));

-- ExpenseCategory  [global]
ALTER TABLE "ExpenseCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExpenseCategory_org_isolation" ON "ExpenseCategory";
CREATE POLICY "ExpenseCategory_org_isolation" ON "ExpenseCategory" FOR ALL
  USING (true)
  WITH CHECK (true);

-- Vendor  [centreId]
ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vendor" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Vendor_org_isolation" ON "Vendor";
CREATE POLICY "Vendor_org_isolation" ON "Vendor" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- HqExpense  [orgId]
ALTER TABLE "HqExpense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HqExpense" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "HqExpense_org_isolation" ON "HqExpense";
CREATE POLICY "HqExpense_org_isolation" ON "HqExpense" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true));

-- StaffGateEvent  [centreId]
ALTER TABLE "StaffGateEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffGateEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "StaffGateEvent_org_isolation" ON "StaffGateEvent";
CREATE POLICY "StaffGateEvent_org_isolation" ON "StaffGateEvent" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- ShortLink  [centreId]
ALTER TABLE "ShortLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShortLink" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ShortLink_org_isolation" ON "ShortLink";
CREATE POLICY "ShortLink_org_isolation" ON "ShortLink" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Requisition  [centreId]
ALTER TABLE "Requisition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Requisition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Requisition_org_isolation" ON "Requisition";
CREATE POLICY "Requisition_org_isolation" ON "Requisition" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Expense  [centreId]
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Expense_org_isolation" ON "Expense";
CREATE POLICY "Expense_org_isolation" ON "Expense" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- Accreditation  [via-fk(Rider.riderId)]
ALTER TABLE "Accreditation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Accreditation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Accreditation_org_isolation" ON "Accreditation";
CREATE POLICY "Accreditation_org_isolation" ON "Accreditation" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Rider" p WHERE p."id" = "Accreditation"."riderId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Rider" p WHERE p."id" = "Accreditation"."riderId"));

-- SalaryPayment  [centreId]
ALTER TABLE "SalaryPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryPayment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SalaryPayment_org_isolation" ON "SalaryPayment";
CREATE POLICY "SalaryPayment_org_isolation" ON "SalaryPayment" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- SalaryStructure  [centreId]
ALTER TABLE "SalaryStructure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryStructure" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SalaryStructure_org_isolation" ON "SalaryStructure";
CREATE POLICY "SalaryStructure_org_isolation" ON "SalaryStructure" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- PayrollConfig  [orgId]
ALTER TABLE "PayrollConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollConfig" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PayrollConfig_org_isolation" ON "PayrollConfig";
CREATE POLICY "PayrollConfig_org_isolation" ON "PayrollConfig" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "orgId" IS NULL OR "orgId" = current_setting('app.org_id',true));

-- CoachDailyUpdate  [centreId]
ALTER TABLE "CoachDailyUpdate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoachDailyUpdate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "CoachDailyUpdate_org_isolation" ON "CoachDailyUpdate";
CREATE POLICY "CoachDailyUpdate_org_isolation" ON "CoachDailyUpdate" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- VenueTrip  [centreId]
ALTER TABLE "VenueTrip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VenueTrip" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VenueTrip_org_isolation" ON "VenueTrip";
CREATE POLICY "VenueTrip_org_isolation" ON "VenueTrip" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- TripChecklistItem  [via-fk(VenueTrip.tripId)]
ALTER TABLE "TripChecklistItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TripChecklistItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TripChecklistItem_org_isolation" ON "TripChecklistItem";
CREATE POLICY "TripChecklistItem_org_isolation" ON "TripChecklistItem" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "VenueTrip" p WHERE p."id" = "TripChecklistItem"."tripId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "VenueTrip" p WHERE p."id" = "TripChecklistItem"."tripId"));

-- AuditRun  [centreId]
ALTER TABLE "AuditRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditRun" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AuditRun_org_isolation" ON "AuditRun";
CREATE POLICY "AuditRun_org_isolation" ON "AuditRun" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));

-- AuditItem  [via-fk(AuditRun.runId)]
ALTER TABLE "AuditItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AuditItem_org_isolation" ON "AuditItem";
CREATE POLICY "AuditItem_org_isolation" ON "AuditItem" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "AuditRun" p WHERE p."id" = "AuditItem"."runId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "AuditRun" p WHERE p."id" = "AuditItem"."runId"));

-- NotificationDispatchLog  [global]
ALTER TABLE "NotificationDispatchLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationDispatchLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "NotificationDispatchLog_org_isolation" ON "NotificationDispatchLog";
CREATE POLICY "NotificationDispatchLog_org_isolation" ON "NotificationDispatchLog" FOR ALL
  USING (true)
  WITH CHECK (true);

-- CronLock  [global]
ALTER TABLE "CronLock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CronLock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "CronLock_org_isolation" ON "CronLock";
CREATE POLICY "CronLock_org_isolation" ON "CronLock" FOR ALL
  USING (true)
  WITH CHECK (true);

-- BatchShiftRequest  [via-fk(Rider.riderId)]
ALTER TABLE "BatchShiftRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BatchShiftRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "BatchShiftRequest_org_isolation" ON "BatchShiftRequest";
CREATE POLICY "BatchShiftRequest_org_isolation" ON "BatchShiftRequest" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Rider" p WHERE p."id" = "BatchShiftRequest"."riderId"))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR EXISTS (SELECT 1 FROM "Rider" p WHERE p."id" = "BatchShiftRequest"."riderId"));

