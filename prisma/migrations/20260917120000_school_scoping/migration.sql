-- Partner schools, so a school administrator can be fenced to their own pupils.
--
-- The SCHOOL_ADMINISTRATOR role was fenced to a CENTRE, not a school: the
-- account saw every rider at its club regardless of which school the child
-- attended. Correct while a centre serves one school, and wrong the moment one
-- does not — GHRC Equiwings already carries riders from four different schools,
-- so giving any one of them a login would have shown them the others' children.
--
-- The old linkage was Rider.school, a free-text box, which cannot act as a
-- fence: "Prakriti" and "Prakriti " are different strings, so one child lands
-- outside their own school's view. This gives every name one canonical row.

CREATE TABLE "School" (
  "id"        TEXT NOT NULL,
  "centreId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- One row per name per centre. NOT globally unique: the same school can
-- legitimately partner with two different centres.
CREATE UNIQUE INDEX "School_centreId_name_key" ON "School"("centreId", "name");
CREATE INDEX "School_centreId_idx" ON "School"("centreId");

ALTER TABLE "School" ADD CONSTRAINT "School_centreId_fkey"
  FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rider.schoolId — the canonical link. Rider.school (free text) is deliberately
-- kept: it is what the parent typed and what an import sheet carries.
ALTER TABLE "Rider" ADD COLUMN "schoolId" TEXT;
CREATE INDEX "Rider_schoolId_idx" ON "Rider"("schoolId");
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- User.schoolId — which school this administrator represents. NULL means "the
-- whole centre", which is what every existing school account gets, so this
-- migration changes nobody's access on the day it lands.
ALTER TABLE "User" ADD COLUMN "schoolId" TEXT;
CREATE INDEX "User_schoolId_idx" ON "User"("schoolId");
ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one School per distinct trimmed name per centre.
--
-- Filtered, because the column is free text and has collected non-answers.
-- Blank and placeholders ("nil", "na", "none", "-") are not schools; those
-- riders keep schoolId NULL, which reads as "no partner school" rather than
-- inventing a school called Nil that somebody could later be fenced to.
-- TRIM collapses "Prakriti" and "Prakriti " into the single row they should
-- always have been.
INSERT INTO "School" ("id", "centreId", "name", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  r."centreId",
  TRIM(r."school"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Rider" r
WHERE r."school" IS NOT NULL
  AND TRIM(r."school") <> ''
  AND LOWER(TRIM(r."school")) NOT IN ('nil', 'na', 'n/a', 'none', '-', '--')
GROUP BY r."centreId", TRIM(r."school")
ON CONFLICT ("centreId", "name") DO NOTHING;

-- Point every rider at the row matching their (centre, trimmed name).
UPDATE "Rider" r
SET "schoolId" = s."id"
FROM "School" s
WHERE s."centreId" = r."centreId"
  AND s."name" = TRIM(r."school")
  AND r."school" IS NOT NULL;

-- RLS. Supabase auto-enables row level security on new tables, so a table with
-- no policy is deny-all and every query fails at runtime rather than at deploy.
-- Same org-isolation shape as every other centre-scoped table.
ALTER TABLE "School" ENABLE ROW LEVEL SECURITY;
-- FORCE as well as ENABLE: without it the policy is skipped for the table's
-- owner, and the app connects as a role that would sail straight past it.
ALTER TABLE "School" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "School_org_isolation" ON "School";
CREATE POLICY "School_org_isolation" ON "School"
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
