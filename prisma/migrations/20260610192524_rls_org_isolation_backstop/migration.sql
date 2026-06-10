-- Row-Level Security org-isolation backstop (defense-in-depth under the
-- app-code tenantWhere filters). Covers every table with a REQUIRED centreId.
--
-- DORMANT BY DEFAULT: each policy passes all rows unless the querying
-- transaction sets app.rls_enforce='on' — which lib/prisma.ts only does when
-- the RLS_ENFORCE=1 env var is set. Rollout = deploy this migration (inert),
-- soak, then flip RLS_ENFORCE=1. Trusted cross-org paths (cron sweeps, owner
-- portal, signature-verified webhooks, public-by-unguessable-id flows) set
-- app.rls_bypass='on' via lib/tenant-context.ts.
--
-- FORCE is required because the app connects as the table owner (owners
-- otherwise skip RLS entirely).

-- ApprovalRequest
ALTER TABLE "ApprovalRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApprovalRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ApprovalRequest_org_isolation" ON "ApprovalRequest"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Assessment
ALTER TABLE "Assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Assessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Assessment_org_isolation" ON "Assessment"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- AuditRun
ALTER TABLE "AuditRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AuditRun_org_isolation" ON "AuditRun"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Batch
ALTER TABLE "Batch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Batch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Batch_org_isolation" ON "Batch"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Certificate
ALTER TABLE "Certificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Certificate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Certificate_org_isolation" ON "Certificate"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- ChecklistSubmission
ALTER TABLE "ChecklistSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistSubmission" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ChecklistSubmission_org_isolation" ON "ChecklistSubmission"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- ChecklistTemplate
ALTER TABLE "ChecklistTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ChecklistTemplate_org_isolation" ON "ChecklistTemplate"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- CoachDailyUpdate
ALTER TABLE "CoachDailyUpdate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoachDailyUpdate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CoachDailyUpdate_org_isolation" ON "CoachDailyUpdate"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Consumable
ALTER TABLE "Consumable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Consumable" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Consumable_org_isolation" ON "Consumable"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Course
ALTER TABLE "Course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Course" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Course_org_isolation" ON "Course"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- EmployeeAdvance
ALTER TABLE "EmployeeAdvance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeAdvance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "EmployeeAdvance_org_isolation" ON "EmployeeAdvance"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- EmployeeOnboarding
ALTER TABLE "EmployeeOnboarding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeOnboarding" FORCE ROW LEVEL SECURITY;
CREATE POLICY "EmployeeOnboarding_org_isolation" ON "EmployeeOnboarding"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- EquipmentStock
ALTER TABLE "EquipmentStock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EquipmentStock" FORCE ROW LEVEL SECURITY;
CREATE POLICY "EquipmentStock_org_isolation" ON "EquipmentStock"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Event
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Event_org_isolation" ON "Event"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Exam
ALTER TABLE "Exam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Exam" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Exam_org_isolation" ON "Exam"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- ExamSitting
ALTER TABLE "ExamSitting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamSitting" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ExamSitting_org_isolation" ON "ExamSitting"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Expense
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Expense_org_isolation" ON "Expense"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Facility
ALTER TABLE "Facility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Facility" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Facility_org_isolation" ON "Facility"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- FacilityBooking
ALTER TABLE "FacilityBooking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FacilityBooking" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FacilityBooking_org_isolation" ON "FacilityBooking"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- FarrierVisit
ALTER TABLE "FarrierVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FarrierVisit" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FarrierVisit_org_isolation" ON "FarrierVisit"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- FeePlan
ALTER TABLE "FeePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeePlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FeePlan_org_isolation" ON "FeePlan"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- FeedPlan
ALTER TABLE "FeedPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FeedPlan_org_isolation" ON "FeedPlan"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Horse
ALTER TABLE "Horse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Horse" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Horse_org_isolation" ON "Horse"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- HorseHealthLog
ALTER TABLE "HorseHealthLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HorseHealthLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "HorseHealthLog_org_isolation" ON "HorseHealthLog"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- InjuryLog
ALTER TABLE "InjuryLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InjuryLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InjuryLog_org_isolation" ON "InjuryLog"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Invoice
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Invoice_org_isolation" ON "Invoice"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- LeaveRequest
ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LeaveRequest_org_isolation" ON "LeaveRequest"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Lesson
ALTER TABLE "Lesson" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lesson" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Lesson_org_isolation" ON "Lesson"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Medicine
ALTER TABLE "Medicine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Medicine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Medicine_org_isolation" ON "Medicine"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- MonthlySkillCatalog
ALTER TABLE "MonthlySkillCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlySkillCatalog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MonthlySkillCatalog_org_isolation" ON "MonthlySkillCatalog"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- ProgressLevel
ALTER TABLE "ProgressLevel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProgressLevel" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ProgressLevel_org_isolation" ON "ProgressLevel"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Requisition
ALTER TABLE "Requisition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Requisition" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Requisition_org_isolation" ON "Requisition"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Rider
ALTER TABLE "Rider" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Rider" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Rider_org_isolation" ON "Rider"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- SalaryPayment
ALTER TABLE "SalaryPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryPayment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SalaryPayment_org_isolation" ON "SalaryPayment"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- SalaryStructure
ALTER TABLE "SalaryStructure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryStructure" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SalaryStructure_org_isolation" ON "SalaryStructure"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- ScoringTemplate
ALTER TABLE "ScoringTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScoringTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ScoringTemplate_org_isolation" ON "ScoringTemplate"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- ShortLink
ALTER TABLE "ShortLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShortLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ShortLink_org_isolation" ON "ShortLink"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Staff
ALTER TABLE "Staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Staff" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Staff_org_isolation" ON "Staff"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- StaffAttendance
ALTER TABLE "StaffAttendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffAttendance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "StaffAttendance_org_isolation" ON "StaffAttendance"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- StaffCertification
ALTER TABLE "StaffCertification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffCertification" FORCE ROW LEVEL SECURITY;
CREATE POLICY "StaffCertification_org_isolation" ON "StaffCertification"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- StaffGateEvent
ALTER TABLE "StaffGateEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffGateEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "StaffGateEvent_org_isolation" ON "StaffGateEvent"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Task
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Task_org_isolation" ON "Task"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Team
ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Team" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Team_org_isolation" ON "Team"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- VaccinationSchedule
ALTER TABLE "VaccinationSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VaccinationSchedule" FORCE ROW LEVEL SECURITY;
CREATE POLICY "VaccinationSchedule_org_isolation" ON "VaccinationSchedule"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- Vendor
ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vendor" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Vendor_org_isolation" ON "Vendor"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- VenueTrip
ALTER TABLE "VenueTrip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VenueTrip" FORCE ROW LEVEL SECURITY;
CREATE POLICY "VenueTrip_org_isolation" ON "VenueTrip"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );

-- VetVisit
ALTER TABLE "VetVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VetVisit" FORCE ROW LEVEL SECURITY;
CREATE POLICY "VetVisit_org_isolation" ON "VetVisit"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );
