-- Supabase smoke test — confirms the Prisma schema is loaded and the
-- connection is fully working (read + write + cleanup).
--
-- Works in BOTH environments:
--   • psql (via scripts/supabase-bootstrap.sh)
--   • Supabase web SQL editor — paste this whole file, click Run.
--
-- Pure SQL only; no psql meta-commands (no \set / \timing / \echo).
-- Idempotent — every probe row this creates is deleted at the end.

-- ---------------------------------------------------------------------
-- 1. Connection sanity — Postgres version + current database + user
-- ---------------------------------------------------------------------
SELECT
  '✓ connection'                          AS check,
  current_database()                      AS database,
  current_user                            AS connected_as,
  version()                               AS postgres_version,
  now()                                   AS server_time;

-- ---------------------------------------------------------------------
-- 2. Schema check — every Prisma-managed table should exist.
-- Single query returns one row with present + missing counts.
-- ---------------------------------------------------------------------
WITH expected(table_name) AS (
  VALUES
    ('Organisation'), ('OrgFeature'), ('PlatformPricing'),
    ('PlatformBillingConfig'), ('SaasInvoice'), ('Announcement'),
    ('AnnouncementDismissal'), ('NpsResponse'),
    ('PlatformUser'), ('PlatformAuditLog'),
    ('Centre'), ('User'), ('Rider'), ('Horse'),
    ('Batch'), ('Lesson'), ('Attendance'),
    ('Competition'), ('CompetitionEntry'), ('CompetitionRound'),
    ('CompetitionRoundScore'), ('CompetitionOfficial'),
    ('JumpEffort'), ('CourseFence'),
    ('DressageTest'), ('DressageScoresheet'),
    ('GymkhanaGame'), ('GymkhanaResult'),
    ('VetCheck'), ('StableAllocation'), ('DrugTest'), ('Protest'),
    ('ExternalEntry'), ('TicketTier'), ('Ticket'),
    ('Exam'), ('Certificate'), ('Accreditation'),
    ('Invoice'), ('Payment'), ('Expense'), ('Vendor'),
    ('FeePlan'), ('Medicine'), ('FarrierVisit'),
    ('VaccinationSchedule'), ('FeedPlan'),
    ('AuditLog'), ('Notification'),
    ('PasswordResetToken'), ('EmailVerifyToken'), ('OwnerPasswordResetToken'),
    ('HorseAllocation'), ('Staff'), ('ParentLink')
)
SELECT
  '✓ tables'                                            AS check,
  count(*) FILTER (WHERE actual.tablename IS NOT NULL)  AS present,
  count(*) FILTER (WHERE actual.tablename IS NULL)      AS missing,
  count(*)                                              AS expected_total
FROM expected
LEFT JOIN pg_tables actual
  ON actual.tablename = expected.table_name
 AND actual.schemaname = 'public';

-- If anything is missing, this lists the names so you can spot which
-- ones the push didn't create. Should be empty.
WITH expected(table_name) AS (
  VALUES
    ('Organisation'), ('OrgFeature'), ('PlatformPricing'),
    ('PlatformBillingConfig'), ('SaasInvoice'), ('Announcement'),
    ('AnnouncementDismissal'), ('NpsResponse'),
    ('PlatformUser'), ('PlatformAuditLog'),
    ('Centre'), ('User'), ('Rider'), ('Horse'),
    ('Batch'), ('Lesson'), ('Attendance'),
    ('Competition'), ('CompetitionEntry'), ('CompetitionRound'),
    ('CompetitionRoundScore'), ('CompetitionOfficial'),
    ('JumpEffort'), ('CourseFence'),
    ('DressageTest'), ('DressageScoresheet'),
    ('GymkhanaGame'), ('GymkhanaResult'),
    ('VetCheck'), ('StableAllocation'), ('DrugTest'), ('Protest'),
    ('ExternalEntry'), ('TicketTier'), ('Ticket'),
    ('Exam'), ('Certificate'), ('Accreditation'),
    ('Invoice'), ('Payment'), ('Expense'), ('Vendor'),
    ('FeePlan'), ('Medicine'), ('FarrierVisit'),
    ('VaccinationSchedule'), ('FeedPlan'),
    ('AuditLog'), ('Notification'),
    ('PasswordResetToken'), ('EmailVerifyToken'), ('OwnerPasswordResetToken'),
    ('HorseAllocation'), ('Staff'), ('ParentLink')
)
SELECT
  '!  missing'                           AS check,
  expected.table_name                    AS table_name
FROM expected
LEFT JOIN pg_tables actual
  ON actual.tablename = expected.table_name
 AND actual.schemaname = 'public'
WHERE actual.tablename IS NULL;

-- ---------------------------------------------------------------------
-- 3. Index presence — sanity check the schema push created indexes.
-- ---------------------------------------------------------------------
SELECT
  '✓ indexes'                            AS check,
  count(*)                               AS index_count
FROM pg_indexes
WHERE schemaname = 'public';

-- ---------------------------------------------------------------------
-- 4. Write probe — insert + select + update + delete on a real table.
--    Uses Organisation because it has the simplest required fields.
--    Wrapped in a DO block so failures raise a clear EXCEPTION.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  probe_id text;
BEGIN
  -- Note: updatedAt is filled explicitly because Prisma's @updatedAt
  -- only fires from the Prisma client; raw SQL needs the value supplied.
  INSERT INTO "Organisation" (id, slug, name, "updatedAt")
  VALUES ('smoke_test_org_zzzzzz', 'smoke-test-zzz', 'Smoke Test Org', now())
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO probe_id;

  IF NOT EXISTS (SELECT 1 FROM "Organisation" WHERE id = probe_id) THEN
    RAISE EXCEPTION 'Probe row not readable after insert';
  END IF;

  UPDATE "Organisation" SET name = 'Smoke Test Org (updated)' WHERE id = probe_id;

  DELETE FROM "Organisation" WHERE id = probe_id;

  RAISE NOTICE '✓ write probe — insert/read/update/delete all succeeded';
END $$;

-- ---------------------------------------------------------------------
-- 5. Row counts — snapshot of what's already in there. Fresh DB = zeros.
-- ---------------------------------------------------------------------
SELECT
  '✓ row counts'                        AS check,
  (SELECT count(*) FROM "Organisation") AS organisations,
  (SELECT count(*) FROM "Centre")       AS centres,
  (SELECT count(*) FROM "User")         AS users,
  (SELECT count(*) FROM "Rider")        AS riders,
  (SELECT count(*) FROM "Horse")        AS horses,
  (SELECT count(*) FROM "Competition")  AS competitions;

-- ---------------------------------------------------------------------
-- 6. Session info — confirms the connection path. Direct vs pooled both
--    succeed; this is mostly diagnostic for connection-string issues.
-- ---------------------------------------------------------------------
SELECT
  '✓ session'                            AS check,
  pg_backend_pid()                       AS backend_pid,
  current_setting('server_version_num')  AS pg_version_num,
  current_setting('TimeZone')            AS timezone;

-- ---------------------------------------------------------------------
-- 7. Final marker — if you see this row, the whole file ran to the end.
-- ---------------------------------------------------------------------
SELECT 'Supabase smoke test passed.' AS result;
