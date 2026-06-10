-- Immutable overdue anchor for tasks. The board's overdue/escalated badges
-- read this instead of the freely-editable dueAt, so nudging dueAt forward
-- can't erase a task's overdue history. Nullable; legacy rows fall back to
-- dueAt in the derivation, and new writes stamp it from the first dueAt.
ALTER TABLE "Task" ADD COLUMN "overdueSince" TIMESTAMP(3);
