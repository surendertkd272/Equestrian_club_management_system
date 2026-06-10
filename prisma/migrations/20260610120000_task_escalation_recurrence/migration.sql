-- Task escalation + recurrence engine (H1).
--   recurrenceSpawnedAt: idempotency guard for the recurrence expander — set
--     once when a recurring task spawns its next occurrence, so it never
--     double-generates even on a double/overlapping cron run.
--   escalatedAt: set when an overdue task is escalated (manager + delegator
--     notified) — dedup so escalation fires once, and a truthful "escalated" mark.
ALTER TABLE "Task" ADD COLUMN "recurrenceSpawnedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "escalatedAt" TIMESTAMP(3);

CREATE INDEX "Task_status_escalatedAt_idx" ON "Task"("status", "escalatedAt");
CREATE INDEX "Task_recurrence_recurrenceSpawnedAt_idx" ON "Task"("recurrence", "recurrenceSpawnedAt");
