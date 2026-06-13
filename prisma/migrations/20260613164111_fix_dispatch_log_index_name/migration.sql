-- Cosmetic: the H5b migration (#91) created this 5-column index with a name
-- longer than Postgres's 63-char identifier limit, so Postgres truncated it to
-- "…_status_creat_i" — which differs from the name Prisma derives from the
-- @@index ("…_status_cre_idx"). Every `prisma migrate diff` therefore proposed
-- a spurious RenameIndex. Align the DB to Prisma's canonical name once.
ALTER INDEX IF EXISTS "NotificationDispatchLog_channel_refType_refRowId_status_creat_i"
  RENAME TO "NotificationDispatchLog_channel_refType_refRowId_status_cre_idx";
