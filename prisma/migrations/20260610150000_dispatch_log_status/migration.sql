-- Per-channel send idempotency (H5). NotificationDispatchLog now records
-- successful sends too (status="sent"), so a send helper can skip a
-- (channel, refType, refRowId, recipient) it already delivered within the
-- dedupe window. Existing rows are dispatch failures → default "failed".
ALTER TABLE "NotificationDispatchLog" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'failed';

CREATE INDEX "NotificationDispatchLog_channel_refType_refRowId_status_creat_idx"
  ON "NotificationDispatchLog"("channel", "refType", "refRowId", "status", "createdAt");
